import { randomUUID } from 'crypto';

import { DataSource, Repository } from 'typeorm';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { DocumentPurgeManifest } from './entities/document-purge-manifest.entity';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { MediaProbeCancellationTombstone } from '../ai/entities/media-probe-cancellation-tombstone.entity';
import { MediaProbeJob } from '../ai/entities/media-probe-job.entity';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';
import { MediaProbeJobRepository } from '../ai/repositories/media-probe-job.repository';
import { ProcessingJobRepository } from '../ai/repositories/processing-job.repository';
import { MediaProbeJobStatus } from '../ai/enums/media-probe-job-status.enum';
import { JobStatus } from '../ai/enums/job-status.enum';
import { JobType } from '../ai/enums/job-type.enum';

describe('ContentRepository.deleteOwnedDocument', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let documents: Repository<Document>;
  let manifests: Repository<DocumentPurgeManifest>;
  let outbox: Repository<OutboxEvent>;
  let mediaProbeCancellations: Repository<MediaProbeCancellationTombstone>;
  let mediaProbeJobs: Repository<MediaProbeJob>;
  let processingJobs: Repository<ProcessingJob>;
  let repository: ContentRepository;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    documents = dataSource.getRepository(Document);
    manifests = dataSource.getRepository(DocumentPurgeManifest);
    outbox = dataSource.getRepository(OutboxEvent);
    mediaProbeCancellations = dataSource.getRepository(MediaProbeCancellationTombstone);
    mediaProbeJobs = dataSource.getRepository(MediaProbeJob);
    processingJobs = dataSource.getRepository(ProcessingJob);
    repository = new ContentRepository(dataSource);
    await db.client.query(
      'TRUNCATE "ai"."media_probe_cancellation_tombstones", "ai"."media_probe_jobs", "ai"."processing_jobs", "course"."document_probe_receipts", "course"."document_purge_manifests", "course"."documents", "course"."outbox" CASCADE',
    );
  });

  it('marks the document DELETING and writes one exact purge handoff', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-42',
      etag: 'etag-42',
      contentLength: 1024,
    });
    const deleted = await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });

    if (!deleted) throw new Error('expected deleted document');
    expect(deleted.id).toBe(document.id);
    expect(deleted.status).toBe(DocumentStatus.DELETING);
    expect(Number(deleted.deletionFence)).toBe(1);
    expect(await manifests.countBy({ documentId: document.id })).toBe(1);
    expect(await outbox.countBy({ aggregateId: document.id, eventType: 'DocumentPurgeRequested' })).toBe(1);
    expect(await outbox.countBy({ aggregateId: document.id, eventType: 'DocumentProcessingCancelled' })).toBe(1);

    const manifest = await manifests.findOneByOrFail({ documentId: document.id });
    expect(manifest.locators).toEqual([
      {
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-42',
        etag: 'etag-42',
        contentLength: 1024,
      },
    ]);
  });

  it('atomically fences AI work and leaves no stale enqueue runnable', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-race',
      etag: 'etag-race',
      contentLength: 1024,
    });
    const mediaJobId = randomUUID();
    const processingJobId = randomUUID();
    await mediaProbeJobs.save(mediaProbeJobs.create({
      id: mediaJobId,
      documentId: document.id,
      ownerId,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: document.fullPipelineJobId,
      sourceBucket: 'learning-platform-dev-media',
      sourceKey: document.storageRef,
      sourceVersionId: 'version-race',
      sourceEtag: 'etag-race',
      sourceContentLength: 1024,
      status: MediaProbeJobStatus.RUNNING,
      idempotencyKey: randomUUID(),
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000),
    }));
    await processingJobs.save(processingJobs.create({
      id: processingJobId,
      documentId: document.id,
      ownerId,
      correlationId: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      status: JobStatus.RUNNING,
      idempotencyKey: randomUUID(),
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000),
      deletionFence: 0,
    }));

    const mediaProbeRepository = new MediaProbeJobRepository(dataSource);
    const processingJobRepository = new ProcessingJobRepository(dataSource);
    await Promise.all([
      repository.deleteOwnedDocument(ownerId, document.id, {
        documents: 'learning-platform-dev-documents',
        media: 'learning-platform-dev-media',
      }),
      mediaProbeRepository.enqueue({
        correlationId: randomUUID(),
        deletionFence: 0,
        documentId: document.id,
        fullPipelineJobId: document.fullPipelineJobId,
        jobType: 'MEDIA_PROBE',
        ownerId,
        policyVersion: 'media-v1',
        probeGeneration: randomUUID(),
        sourceBucket: 'learning-platform-dev-media',
        sourceKey: document.storageRef,
        sourceVersionId: 'version-race',
        sourceEtag: 'etag-race',
        sourceContentLength: 1024,
      }, randomUUID()),
      processingJobRepository.enqueue({
        correlationId: randomUUID(),
        deletionFence: 0,
        documentId: document.id,
        fullPipelineJobId: document.fullPipelineJobId,
        jobType: JobType.FULL_PIPELINE,
        ownerId,
        processingAttempt: 1,
      }, randomUUID()),
    ]);

    await expect(mediaProbeCancellations.findOneByOrFail({
      documentId: document.id,
      ownerId,
      deletionFence: 1,
    })).resolves.toMatchObject({
      reason: 'DOCUMENT_DELETED',
    });
    await expect(mediaProbeJobs.findOneByOrFail({ id: mediaJobId })).resolves.toMatchObject({
      status: MediaProbeJobStatus.CANCELLED,
      leaseId: null,
      leaseUntil: null,
    });
    await expect(processingJobs.findOneByOrFail({ id: processingJobId })).resolves.toMatchObject({
      status: JobStatus.CANCELLED,
      cancellationReason: 'DOCUMENT_DELETED',
      leaseId: null,
      leaseUntil: null,
    });
    const processingRows = await processingJobs.findBy({ documentId: document.id });
    expect(processingRows).toHaveLength(1);
    expect(processingRows[0].status).toBe(JobStatus.CANCELLED);
  });

  it('canonicalizes whitespace around a persisted media VersionId', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO);
    const locator = {
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: '  version-canonical  ',
      etag: '  etag-canonical  ',
      contentLength: 1024,
    } as const;

    await repository.confirmMediaProbe(ownerId, document.id, {
      customModelConfigId: null,
      kind: 'PLAN',
      platformModelId: 'platform-default',
    }, 'media-v1', locator);

    await expect(documents.findOneByOrFail({ id: document.id })).resolves.toMatchObject({
      mediaSourceVersionId: 'version-canonical',
      mediaSourceEtag: 'etag-canonical',
    });
    await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });
    await expect(manifests.findOneByOrFail({ documentId: document.id })).resolves.toMatchObject({
      locators: [{ versionId: 'version-canonical', etag: 'etag-canonical' }],
    });
  });

  it('uses the locator persisted by confirm when deletion happens before probe receipt', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO);
    const locator = {
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: 'version-confirmed',
      etag: 'etag-confirmed',
      contentLength: 1024,
    } as const;

    await repository.confirmMediaProbe(ownerId, document.id, {
      customModelConfigId: null,
      kind: 'PLAN',
      platformModelId: 'platform-default',
    }, 'media-v1', locator);
    await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });

    await expect(manifests.findOneByOrFail({ documentId: document.id })).resolves.toMatchObject({
      locators: [locator],
    });
  });

  it('rejects a different media locator after the source identity is persisted', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-confirmed',
      etag: 'etag-confirmed',
      contentLength: 1024,
    });

    await expect(repository.confirmMediaProbe(ownerId, document.id, {
      customModelConfigId: null,
      kind: 'PLAN',
      platformModelId: 'platform-default',
    }, 'media-v1', {
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: 'version-overwritten',
      etag: 'etag-overwritten',
      contentLength: 1024,
    })).rejects.toThrow('Media source locator changed after persistence');

    await expect(documents.findOneByOrFail({ id: document.id })).resolves.toMatchObject({
      status: DocumentStatus.UPLOADED,
      mediaSourceVersionId: 'version-confirmed',
      mediaSourceEtag: 'etag-confirmed',
    });
    await expect(outbox.countBy({ aggregateId: document.id })).resolves.toBe(0);
  });

  it('ignores stale preflight metadata after processing has persisted a source identity', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-confirmed',
      etag: 'etag-confirmed',
      contentLength: 1024,
    });
    await documents.update({ id: document.id }, { status: DocumentStatus.PROCESSING });

    await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    }, {
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: 'version-stale',
      etag: 'etag-stale',
      contentLength: 1024,
    });

    await expect(manifests.findOneByOrFail({ documentId: document.id })).resolves.toMatchObject({
      locators: [{
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-confirmed',
        etag: 'etag-confirmed',
        contentLength: 1024,
      }],
    });
  });

  it('includes an immutable locator from an old probe receipt', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO);
    await db.client.query(
      `INSERT INTO "course"."document_probe_receipts"
         ("probe_result_id", "document_id", "owner_id", "full_pipeline_job_id",
          "probe_generation", "policy_version", "deletion_fence", "duration_sec",
          "source_bucket", "source_key", "source_version_id", "source_etag", "source_content_length")
       VALUES ($1, $2, $3, $4, $5, $6, 0, 120, $7, $8, $9, $10, 1024)`,
      [
        randomUUID(),
        document.id,
        ownerId,
        randomUUID(),
        randomUUID(),
        'media-v1',
        'learning-platform-dev-media',
        document.storageRef,
        'version-42',
        'etag-42',
      ],
    );

    await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });

    const manifest = await manifests.findOneByOrFail({ documentId: document.id });
    expect(manifest.locators).toEqual([{
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: 'version-42',
      etag: 'etag-42',
      contentLength: 1024,
    }]);
  });

  it('unions and deduplicates every locator across two probe generations', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-current',
      etag: 'etag-current',
      contentLength: 1024,
    });
    const generations = [
      { versionId: 'version-one', etag: 'etag-one', generation: randomUUID() },
      { versionId: 'version-two', etag: 'etag-two', generation: randomUUID() },
    ];

    for (const generation of generations) {
      await db.client.query(
        `INSERT INTO "course"."document_probe_receipts"
           ("probe_result_id", "document_id", "owner_id", "full_pipeline_job_id",
            "probe_generation", "policy_version", "deletion_fence", "duration_sec",
            "source_bucket", "source_key", "source_version_id", "source_etag", "source_content_length")
         VALUES ($1, $2, $3, $4, $5, $6, 0, 120, $7, $8, $9, $10, 1024)`,
        [
          randomUUID(),
          document.id,
          ownerId,
          randomUUID(),
          generation.generation,
          'media-v1',
          'learning-platform-dev-media',
          document.storageRef,
          generation.versionId,
          generation.etag,
        ],
      );
    }

    await repository.deleteOwnedDocument(ownerId, document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });

    const manifest = await manifests.findOneByOrFail({ documentId: document.id });
    expect(manifest.locators).toEqual([
      {
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-current',
        etag: 'etag-current',
        contentLength: 1024,
      },
      {
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-one',
        etag: 'etag-one',
        contentLength: 1024,
      },
      {
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-two',
        etag: 'etag-two',
        contentLength: 1024,
      },
    ]);
  });

  it('retains course purge history after document deletion', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.VIDEO);
    const probeResultId = randomUUID();
    await db.client.query(
      `INSERT INTO "course"."document_probe_receipts"
         ("probe_result_id", "document_id", "owner_id", "full_pipeline_job_id",
          "probe_generation", "policy_version", "deletion_fence", "duration_sec",
          "source_bucket", "source_key", "source_version_id", "source_etag", "source_content_length")
       VALUES ($1, $2, $3, $4, $5, $6, 0, 120, $7, $8, $9, $10, 1024)`,
      [
        probeResultId,
        document.id,
        ownerId,
        randomUUID(),
        randomUUID(),
        'media-v1',
        'learning-platform-dev-media',
        document.storageRef,
        'version-success',
        'etag-success',
      ],
    );
    const manifest = await manifests.save(manifests.create({
      documentId: document.id,
      ownerId,
      deletionFence: 1,
      idempotencyKey: `document-purge:${document.id}:1`,
      locators: [{
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-success',
        etag: 'etag-success',
        contentLength: 1024,
      }],
    }));
    const courseHistory = await outbox.save(outbox.create({
      aggregateId: document.id,
      eventType: 'DocumentPurgeRequested',
      payload: { documentId: document.id },
      publishedAt: new Date(),
    }));

    await documents.delete(document.id);

    await expect(documents.findOneBy({ id: document.id })).resolves.toBeNull();
    await expect(db.client.query(
      'SELECT 1 FROM "course"."document_probe_receipts" WHERE "probe_result_id" = $1',
      [probeResultId],
    )).resolves.toMatchObject({ rows: [] });
    await expect(manifests.findOneBy({ id: manifest.id })).resolves.toMatchObject({
      id: manifest.id,
      documentId: document.id,
    });
    await expect(outbox.findOneBy({ id: courseHistory.id })).resolves.toMatchObject({ id: courseHistory.id });
  });

  it('deletes one document without changing another document\'s purge history', async () => {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const documentA = await seedDocument(ownerA, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-a',
      etag: 'etag-a',
      contentLength: 1024,
    });
    const documentB = await seedDocument(ownerB, DocumentType.VIDEO, {
      bucket: 'learning-platform-dev-media',
      versionId: 'version-b',
      etag: 'etag-b',
      contentLength: 1024,
    });

    await repository.deleteOwnedDocument(ownerB, documentB.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });
    await repository.deleteOwnedDocument(ownerA, documentA.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    });

    await expect(manifests.findOneByOrFail({ documentId: documentA.id })).resolves.toMatchObject({
      documentId: documentA.id,
      locators: [{ versionId: 'version-a' }],
    });
    await expect(manifests.findOneByOrFail({ documentId: documentB.id })).resolves.toMatchObject({
      documentId: documentB.id,
      locators: [{ versionId: 'version-b' }],
    });
  });

  it('is owner-scoped and leaves no side effects for a stranger', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.PDF);

    await expect(repository.deleteOwnedDocument(randomUUID(), document.id, {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    })).resolves.toBeNull();

    const unchanged = await documents.findOneByOrFail({ id: document.id });
    expect(unchanged.status).toBe(DocumentStatus.UPLOADED);
    expect(Number(unchanged.deletionFence)).toBe(0);
    expect(await manifests.countBy({ documentId: document.id })).toBe(0);
    expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
  });

  it('is idempotent after the first committed deletion', async () => {
    const ownerId = randomUUID();
    const document = await seedDocument(ownerId, DocumentType.PDF);
    const buckets = {
      documents: 'learning-platform-dev-documents',
      media: 'learning-platform-dev-media',
    };

    await repository.deleteOwnedDocument(ownerId, document.id, buckets);
    await repository.deleteOwnedDocument(ownerId, document.id, buckets);

    expect(await manifests.countBy({ documentId: document.id })).toBe(1);
    expect(await outbox.countBy({ aggregateId: document.id, eventType: 'DocumentPurgeRequested' })).toBe(1);
    expect(Number((await documents.findOneByOrFail({ id: document.id })).deletionFence)).toBe(1);
  });

  async function seedDocument(
    ownerId: string,
    type: DocumentType,
    mediaLocator?: {
      readonly bucket: string;
      readonly versionId: string;
      readonly etag: string;
      readonly contentLength: number;
    },
  ): Promise<Document> {
    return documents.save(documents.create({
      ownerId,
      type,
      originalName: type === DocumentType.VIDEO ? 'lecture.mp4' : 'notes.pdf',
      storageRef: `${ownerId}/${randomUUID()}${type === DocumentType.VIDEO ? '.mp4' : '.pdf'}`,
      sizeBytes: 1024,
      status: DocumentStatus.UPLOADED,
      ...(mediaLocator ? {
        mediaSourceBucket: mediaLocator.bucket,
        mediaSourceVersionId: mediaLocator.versionId,
        mediaSourceEtag: mediaLocator.etag,
        mediaSourceContentLength: mediaLocator.contentLength,
      } : {}),
    }));
  }
});
