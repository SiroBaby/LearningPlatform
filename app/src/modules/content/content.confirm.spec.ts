import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { MediaProbeJob } from '../ai/entities/media-probe-job.entity';
import { MediaProbeResult } from '../ai/entities/media-probe-result.entity';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { MediaProbeJobStatus } from '../ai/enums/media-probe-job-status.enum';
import { JobStatus } from '../ai/enums/job-status.enum';
import { JobType } from '../ai/enums/job-type.enum';
import { ContentService } from './content.service';
import { MAX_MP3_SIZE_BYTES } from './contracts/document-upload-policy';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { OutboxEvent } from './entities/outbox-event.entity';
import { ContentRepository } from './repositories/content.repository';

describe('ContentService.confirm', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let service: ContentService;
  let documents: Repository<Document>;
  let outbox: Repository<OutboxEvent>;
  let mediaProbeJobs: Repository<MediaProbeJob>;
  let mediaProbeResults: Repository<MediaProbeResult>;
  let processingJobs: Repository<ProcessingJob>;
  let verifier: FakeStorageVerifier;
  let storage: { getBucketName: (bucketKind: 'documents' | 'media') => string };

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    if (db) {
      await db.stop();
    }
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    documents = dataSource.getRepository(Document);
    outbox = dataSource.getRepository(OutboxEvent);
    mediaProbeJobs = dataSource.getRepository(MediaProbeJob);
    mediaProbeResults = dataSource.getRepository(MediaProbeResult);
    processingJobs = dataSource.getRepository(ProcessingJob);
    verifier = new FakeStorageVerifier();
    storage = {
      getBucketName: (bucketKind) => bucketKind === 'media' ? 'learning-platform-dev-media-custom' : 'learning-platform-dev-documents',
    };
    service = new ContentService(
      new ContentRepository(dataSource),
      storage as never,
      verifier,
      null as never,
    );
    await db.client.query(
      'TRUNCATE "ai"."media_probe_results", "ai"."media_probe_jobs", "ai"."processing_jobs", "course"."document_probe_receipts", "course"."documents", "course"."outbox" CASCADE',
    );
  });

  async function seedUploaded(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        ownerId,
        type: DocumentType.PDF,
        originalName: 'bai-giang.pdf',
        storageRef: `${ownerId}/${randomUUID()}.pdf`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );
  }

  async function seedRetryableFailure(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
        errorMessage: 'Document processing is temporarily unavailable. Please try again later.',
        ownerId,
        originalName: 'bai-giang.pdf',
        sizeBytes: 1024,
        status: DocumentStatus.FAILED,
        storageRef: `${ownerId}/${randomUUID()}.pdf`,
        type: DocumentType.PDF,
      }),
    );
  }

  async function seedUploadedMedia(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        ownerId,
        type: DocumentType.AUDIO,
        originalName: 'lecture.mp3',
        storageRef: `${ownerId}/${randomUUID()}.mp3`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );
  }

  it('chuyển UPLOADED -> PROCESSING và ghi đúng 1 outbox row', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);

    await service.confirm(owner, doc.id);

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.PROCESSING);

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('DocumentReadyForProcessing');
    // owner_id truyền qua data plane (ADR-0018)
    expect(rows[0].payload.ownerId).toBe(owner);
  });

  it('idempotent: confirm 2 lần chỉ tạo 1 outbox row (CAS, ADR-0005)', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);

    await service.confirm(owner, doc.id);
    await service.confirm(owner, doc.id);

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
  });

  it('retry CAS: concurrent submissions start one processing attempt only', async () => {
    const owner = randomUUID();
    const doc = await seedRetryableFailure(owner);
    const repository = new ContentRepository(dataSource);
    const selection = {
      customModelConfigId: null,
      kind: 'PLAN' as const,
      platformModelId: 'platform-default',
    };

    const results = await Promise.all([
      repository.retryProcessing(owner, doc.id, selection),
      repository.retryProcessing(owner, doc.id, selection),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(1);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.PROCESSING);
  });

  it('ownership: owner khác -> 404, không đổi status, không ghi outbox', async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const doc = await seedUploaded(owner);

    await expect(service.confirm(stranger, doc.id)).rejects.toMatchObject({
      status: 404,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(0);
  });

  it('verify fail (magic bytes sai) -> reject, status không đổi', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);
    verifier.setResult({ magicBytesValid: false });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({
      status: 400,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
  });

  it('verify fail (object size khác declared size) -> reject, status không đổi', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);
    verifier.setResult({ sizeBytes: 1025 });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({
      status: 400,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
  });

  it('confirm media chuyển UPLOADED -> PROBING và ghi một probe outbox', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);

    const confirmed = await service.confirm(owner, doc.id);

    expect(confirmed.status).toBe(DocumentStatus.PROBING);
    expect(verifier.lastBucketKind).toBe('media');
    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.PROBING);
    expect(reloaded.probeGeneration).toEqual(expect.any(String));
    expect(reloaded.probePolicyVersion).toBe('media-v1');

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('DocumentProbeRequested');
    expect(rows[0].payload).toMatchObject({
      documentId: doc.id,
      jobType: 'MEDIA_PROBE',
      ownerId: owner,
      policyVersion: 'media-v1',
      probeGeneration: reloaded.probeGeneration,
      sourceBucket: 'learning-platform-dev-media-custom',
      sourceKey: doc.storageRef,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    });
  });

  it('re-probe reuses the existing canonical FULL_PIPELINE job id', async () => {
    const owner = randomUUID();
    const retainedJobId = randomUUID();
    const doc = await documents.save(documents.create({
      errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      errorMessage: 'Document processing is temporarily unavailable.',
      ownerId: owner,
      type: DocumentType.AUDIO,
      originalName: 'lecture.mp3',
      storageRef: `${owner}/${randomUUID()}.mp3`,
      sizeBytes: 1024,
      status: DocumentStatus.FAILED,
      fullPipelineJobId: retainedJobId,
    }));
    await processingJobs.save(processingJobs.create({
      id: retainedJobId,
      documentId: doc.id,
      ownerId: owner,
      correlationId: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      status: JobStatus.FAILED,
      idempotencyKey: randomUUID(),
    }));

    await service.confirm(owner, doc.id);

    const [probeRequest] = await outbox.find({ where: { aggregateId: doc.id } });
    expect(probeRequest.payload.fullPipelineJobId).toBe(retainedJobId);
    expect(probeRequest.payload.processingAttempt).toBe(1);
  });

  it('re-probe giữ canonical job id qua event, result, receipt và processing request', async () => {
    const owner = randomUUID();
    const retainedJobId = randomUUID();
    const doc = await documents.save(documents.create({
      errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      errorMessage: 'Document processing is temporarily unavailable.',
      ownerId: owner,
      type: DocumentType.AUDIO,
      originalName: 'lecture.mp3',
      storageRef: `${owner}/${randomUUID()}.mp3`,
      sizeBytes: 1024,
      status: DocumentStatus.FAILED,
      fullPipelineJobId: retainedJobId,
    }));
    await processingJobs.save(processingJobs.create({
      id: retainedJobId,
      documentId: doc.id,
      ownerId: owner,
      correlationId: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      status: JobStatus.FAILED,
      idempotencyKey: randomUUID(),
    }));

    const repository = new ContentRepository(dataSource);
    const first = await service.confirm(owner, doc.id);
    const firstGeneration = first.probeGeneration!;
    const firstLocator = {
      bucket: 'learning-platform-dev-media-custom',
      key: doc.storageRef,
      versionId: 'version-1',
      etag: 'etag-1',
      contentLength: 1024,
    } as const;
    const [firstRequest] = await outbox.find({ where: { aggregateId: doc.id, eventType: 'DocumentProbeRequested' } });
    expect(firstRequest.payload.fullPipelineJobId).toBe(retainedJobId);
    expect(firstRequest.payload.processingAttempt).toBe(1);
    const firstProbeJob = await mediaProbeJobs.save(mediaProbeJobs.create({
      documentId: doc.id,
      ownerId: owner,
      correlationId: randomUUID(),
      probeGeneration: firstGeneration,
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: retainedJobId,
      sourceBucket: firstLocator.bucket,
      sourceKey: firstLocator.key,
      sourceVersionId: firstLocator.versionId,
      sourceEtag: firstLocator.etag,
      sourceContentLength: firstLocator.contentLength,
      status: MediaProbeJobStatus.COMPLETED,
      idempotencyKey: randomUUID(),
    }));
    const firstResultId = randomUUID();
    await mediaProbeResults.save(mediaProbeResults.create({
      id: firstResultId,
      mediaProbeJobId: firstProbeJob.id,
      documentId: doc.id,
      ownerId: owner,
      probeGeneration: firstGeneration,
      policyVersion: 'media-v1',
      deletionFence: 0,
      durationSec: 120,
      bucket: firstLocator.bucket,
      objectKey: firstLocator.key,
      versionId: firstLocator.versionId,
      etag: firstLocator.etag,
      contentLength: firstLocator.contentLength,
      fullPipelineJobId: retainedJobId,
    }));
    await expect(repository.completeProbe({
      deletionFence: 0,
      documentId: doc.id,
      durationSec: 120,
      eventCreatedAt: new Date(),
      fullPipelineJobId: retainedJobId,
      ownerId: owner,
      policyVersion: 'media-v1',
      probeResultId: firstResultId,
      probeGeneration: firstGeneration,
      locator: firstLocator,
    })).resolves.toBe('APPLIED');

    await documents.update(
      { id: doc.id },
      {
        errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
        errorMessage: 'Document processing is temporarily unavailable.',
        status: DocumentStatus.FAILED,
      },
    );
    verifier.setResult({ versionId: 'version-2', etag: 'etag-2' });

    const second = await service.confirm(owner, doc.id);
    const secondGeneration = second.probeGeneration!;
    expect(secondGeneration).not.toBe(firstGeneration);
    const secondLocator = firstLocator;
    expect(verifier.verifyCalls).toBe(1);
    const secondRequest = (await outbox.find({ where: { aggregateId: doc.id, eventType: 'DocumentProbeRequested' } }))
      .find((request) => request.payload.probeGeneration === secondGeneration)!;
    expect(secondRequest.payload.fullPipelineJobId).toBe(retainedJobId);
    expect(secondRequest.payload.processingAttempt).toBe(2);
    const secondProbeJob = await mediaProbeJobs.save(mediaProbeJobs.create({
      documentId: doc.id,
      ownerId: owner,
      correlationId: randomUUID(),
      probeGeneration: secondGeneration,
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: retainedJobId,
      sourceBucket: secondLocator.bucket,
      sourceKey: secondLocator.key,
      sourceVersionId: secondLocator.versionId,
      sourceEtag: secondLocator.etag,
      sourceContentLength: secondLocator.contentLength,
      status: MediaProbeJobStatus.COMPLETED,
      idempotencyKey: randomUUID(),
    }));
    const secondResultId = randomUUID();
    await mediaProbeResults.save(mediaProbeResults.create({
      id: secondResultId,
      mediaProbeJobId: secondProbeJob.id,
      documentId: doc.id,
      ownerId: owner,
      probeGeneration: secondGeneration,
      policyVersion: 'media-v1',
      deletionFence: 0,
      durationSec: 180,
      bucket: secondLocator.bucket,
      objectKey: secondLocator.key,
      versionId: secondLocator.versionId,
      etag: secondLocator.etag,
      contentLength: secondLocator.contentLength,
      fullPipelineJobId: retainedJobId,
    }));
    await expect(repository.completeProbe({
      deletionFence: 0,
      documentId: doc.id,
      durationSec: 180,
      eventCreatedAt: new Date(),
      fullPipelineJobId: retainedJobId,
      ownerId: owner,
      policyVersion: 'media-v1',
      probeResultId: secondResultId,
      probeGeneration: secondGeneration,
      locator: secondLocator,
    })).resolves.toBe('APPLIED');

    const persistedJobs = await processingJobs.findBy({ documentId: doc.id });
    expect(persistedJobs).toHaveLength(1);
    expect(persistedJobs[0].id).toBe(retainedJobId);
    expect((await mediaProbeResults.findBy({ documentId: doc.id }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstResultId, fullPipelineJobId: retainedJobId }),
        expect.objectContaining({ id: secondResultId, fullPipelineJobId: retainedJobId }),
      ]),
    );
    const receiptRows = await db.client.query<{ readonly fullPipelineJobId: string; readonly probeResultId: string }>(
      'SELECT "full_pipeline_job_id" AS "fullPipelineJobId", "probe_result_id" AS "probeResultId" FROM "course"."document_probe_receipts" WHERE "document_id" = $1',
      [doc.id],
    );
    expect(receiptRows.rows).toEqual(expect.arrayContaining([
      { fullPipelineJobId: retainedJobId, probeResultId: firstResultId },
      { fullPipelineJobId: retainedJobId, probeResultId: secondResultId },
    ]));
    const processingRequests = await outbox.find({ where: { aggregateId: doc.id, eventType: 'DocumentReadyForProcessing' } });
    expect(processingRequests).toHaveLength(2);
    expect(processingRequests.map((request) => request.payload.fullPipelineJobId)).toEqual([
      retainedJobId,
      retainedJobId,
    ]);
    expect(processingRequests.map((request) => request.payload.processingAttempt)).toEqual([1, 2]);
  });

  it('confirm media lặp lại là no-op, không tạo probe outbox thứ hai', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);

    await service.confirm(owner, doc.id);
    const first = await documents.findOneByOrFail({ id: doc.id });
    await service.confirm(owner, doc.id);

    const second = await documents.findOneByOrFail({ id: doc.id });
    expect(second.status).toBe(DocumentStatus.PROBING);
    expect(second.probeGeneration).toBe(first.probeGeneration);
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(1);
  });

  it('confirm media video verifies the physical media bucket before probing', async () => {
    const owner = randomUUID();
    const doc = await documents.save(
      documents.create({
        ownerId: owner,
        type: DocumentType.VIDEO,
        originalName: 'lecture.mp4',
        storageRef: `media/${owner}/${randomUUID()}.mp4`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );

    await expect(service.confirm(owner, doc.id)).resolves.toMatchObject({
      status: DocumentStatus.PROBING,
    });
    expect(verifier.lastBucketKind).toBe('media');
  });

  it('rejects media confirmation when the object is missing from the media bucket', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);
    verifier.setResult({ exists: false, sizeBytes: 0 });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(verifier.lastBucketKind).toBe('media');
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(0);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.UPLOADED);
  });

  it('rejects media confirmation when storage versioning metadata is missing', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);
    verifier.setResult({ versionId: undefined });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(0);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.UPLOADED);
  });

  it('confirm rejects a media document over its policy cap', async () => {
    const owner = randomUUID();
    const doc = await documents.save(
      documents.create({
        ownerId: owner,
        type: DocumentType.AUDIO,
        originalName: 'lecture.mp3',
        storageRef: `${owner}/${randomUUID()}.mp3`,
        sizeBytes: MAX_MP3_SIZE_BYTES + 1,
        status: DocumentStatus.UPLOADED,
      }),
    );

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(verifier.lastBucketKind).toBeUndefined();
  });
});
