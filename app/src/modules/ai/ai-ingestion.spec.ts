import { createHash, randomUUID } from 'crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { AiIngestionService } from './ai-ingestion.service';
import {
  MEDIA_PROBE_JOB_TYPE,
  type EnqueueCommand,
} from './contracts/ai-ingestion.port';
import { ProcessingJob } from './entities/processing-job.entity';
import { MediaProbeJob } from './entities/media-probe-job.entity';
import { MediaProbeCancellationTombstone } from './entities/media-probe-cancellation-tombstone.entity';
import { MediaProbeResult } from './entities/media-probe-result.entity';
import { Document } from '../content/entities/document.entity';
import { DocumentStatus } from '../content/enums/document-status.enum';
import { DocumentType } from '../content/enums/document-type.enum';
import { JobStatus } from './enums/job-status.enum';
import { JobType } from './enums/job-type.enum';
import { MediaProbeJobStatus } from './enums/media-probe-job-status.enum';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { MediaProbeJobRepository } from './repositories/media-probe-job.repository';

// Deep module quan trọng nhất (ADR-0012/0019): upsert idempotent.
describe('AiIngestionService.enqueue', () => {
  let db: TestDb;
  let ds: DataSource;
  let jobs: Repository<ProcessingJob>;
  let mediaProbeJobs: Repository<MediaProbeJob>;
  let mediaProbeCancellations: Repository<MediaProbeCancellationTombstone>;
  let mediaProbeResults: Repository<MediaProbeResult>;
  let documents: Repository<Document>;
  let ingestion: AiIngestionService;
  let baseDocumentId: string;
  let baseOwnerId: string;

  const baseCmd = () => ({
    documentId: baseDocumentId,
    ownerId: baseOwnerId,
    jobType: JobType.FULL_PIPELINE,
    correlationId: randomUUID(),
  });

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    if (db) {
      await db.stop();
    }
  });

  beforeEach(async () => {
    ds = await createTestDataSource(db.container);
    jobs = ds.getRepository(ProcessingJob);
    mediaProbeJobs = ds.getRepository(MediaProbeJob);
    mediaProbeCancellations = ds.getRepository(MediaProbeCancellationTombstone);
    mediaProbeResults = ds.getRepository(MediaProbeResult);
    documents = ds.getRepository(Document);
    ingestion = new AiIngestionService(
      new ProcessingJobRepository(ds),
      new MediaProbeJobRepository(ds),
    );
    await db.client.query('TRUNCATE "course"."documents", "ai"."processing_jobs", "ai"."media_probe_cancellation_tombstones", "ai"."media_probe_jobs" CASCADE');
    baseDocumentId = randomUUID();
    baseOwnerId = randomUUID();
    await documents.save(documents.create({
      id: baseDocumentId,
      ownerId: baseOwnerId,
      type: DocumentType.TEXT,
      originalName: 'fixture.txt',
      storageRef: `fixtures/${baseDocumentId}.txt`,
      sizeBytes: 1024,
      status: DocumentStatus.PROCESSING,
    }));
  });

  it('chưa có job -> insert PENDING, mang owner_id từ command (ADR-0018)', async () => {
    const cmd = baseCmd();
    await ingestion.enqueue(cmd);

    const found = await jobs.findOneByOrFail({ documentId: cmd.documentId });
    expect(found.status).toBe(JobStatus.PENDING);
    expect(found.ownerId).toBe(cmd.ownerId);
    expect(found.attempts).toBe(0);
  });

  it('gọi 2 lần cùng (document, jobType) -> chỉ 1 job (idempotent)', async () => {
    const cmd = baseCmd();
    await ingestion.enqueue(cmd);
    await ingestion.enqueue(cmd);

    const all = await jobs.findBy({ documentId: cmd.documentId });
    expect(all).toHaveLength(1);
  });

  it('cho phép nhiều MEDIA_PROBE generation/policy trên cùng Document nhưng delivery lặp vẫn idempotent', async () => {
    const documentId = randomUUID();
    const first = {
      documentId,
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    };
    const second = {
      ...first,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v2',
    };

    await seedMediaDocument(first);
    await ingestion.enqueue(first);
    await ingestion.enqueue(first);
    await documents.update(
      { id: documentId },
      { probeGeneration: second.probeGeneration, probePolicyVersion: second.policyVersion },
    );
    await ingestion.enqueue(second);

    const all = await mediaProbeJobs.findBy({ documentId });
    expect(all).toHaveLength(2);
    expect(all.map((job) => [job.probeGeneration, job.policyVersion])).toEqual(expect.arrayContaining([
      [first.probeGeneration, first.policyVersion],
      [second.probeGeneration, second.policyVersion],
    ]));
    expect(all.find((job) => job.probeGeneration === first.probeGeneration)?.idempotencyKey).toBe(
      createHash('sha256')
        .update(`${documentId}:${first.probeGeneration}:${first.policyVersion}`)
        .digest('hex')
        .slice(0, 64),
    );
  });

  it('từ chối delivery cùng idempotency key nhưng locator đã bị thay đổi', async () => {
    const command = {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    } as const;
    await seedMediaDocument(command);

    await ingestion.enqueue(command);
    await expect(ingestion.enqueue({
      ...command,
      sourceVersionId: 'version-2',
    })).rejects.toThrow('Media probe idempotency conflict');

    const persisted = await mediaProbeJobs.findOneByOrFail({ documentId: command.documentId });
    expect(persisted).toMatchObject({
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
    });
    expect(Number(persisted.sourceContentLength)).toBe(1024);
  });

  it.each(['null', ' NULL ', 'NuLl'])('từ chối MEDIA_PROBE khi VersionId là placeholder %j', async (sourceVersionId) => {
    const command = {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId,
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    } as const;

    await seedMediaDocument(command);

    await expect(ingestion.enqueue(command)).rejects.toThrow(
      'MEDIA_PROBE requires probeGeneration, policyVersion, immutable source locator and deletionFence',
    );
    await expect(mediaProbeJobs.findBy({ documentId: command.documentId })).resolves.toHaveLength(0);
  });

  it('giữ FULL_PIPELINE độc lập và idempotent bên cạnh các probe generation', async () => {
    const documentId = randomUUID();
    const probe = {
      documentId,
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    };
    const fullPipeline = {
      documentId,
      ownerId: probe.ownerId,
      jobType: JobType.FULL_PIPELINE,
      correlationId: randomUUID(),
    };

    await seedMediaDocument(probe);
    await ingestion.enqueue(probe);
    await documents.update({ id: documentId }, { status: DocumentStatus.PROCESSING });
    await ingestion.enqueue(fullPipeline);
    await ingestion.enqueue(fullPipeline);

    const all = await jobs.findBy({ documentId });
    expect(all).toHaveLength(1);
    expect(await mediaProbeJobs.findBy({ documentId })).toHaveLength(1);
    expect(all.filter((job) => job.jobType === JobType.FULL_PIPELINE)).toHaveLength(1);
  });

  it('giữ media probe trong AI boundary và hủy job mà không đổi deletion fence lịch sử', async () => {
    const command = {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    } as const;
    await seedMediaDocument(command, DocumentStatus.DELETING);

    await ingestion.enqueue(command);
    const job = await mediaProbeJobs.findOneByOrFail({ documentId: command.documentId });
    await mediaProbeJobs.update(
      { id: job.id },
      {
        status: MediaProbeJobStatus.RUNNING,
        deletionFence: 0,
        leaseId: randomUUID(),
        leaseUntil: new Date(Date.now() + 60_000),
      },
    );

    await ingestion.cancelDocument({
      documentId: command.documentId,
      ownerId: command.ownerId,
      deletionFence: 1,
      reason: 'DOCUMENT_DELETED',
    });

    const cancelledJob = await mediaProbeJobs.findOneByOrFail({ id: job.id });
    expect(cancelledJob).toMatchObject({
      status: MediaProbeJobStatus.CANCELLED,
      leaseId: null,
      leaseUntil: null,
    });
    expect(Number(cancelledJob.deletionFence)).toBe(0);
  });

  it('dùng AI-owned cancellation tombstone để chặn event cũ sau khi Document đã bị xóa', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const command = {
      correlationId: randomUUID(),
      documentId,
      jobType: JobType.FULL_PIPELINE,
      ownerId,
    } as const;

    await ingestion.cancelDocument({
      deletionFence: 1,
      documentId,
      ownerId,
      reason: 'DOCUMENT_DELETED',
    });
    const tombstone = await jobs.findOneByOrFail({ documentId });
    expect(tombstone).toMatchObject({
      cancellationReason: 'DOCUMENT_DELETED',
      status: JobStatus.CANCELLED,
    });
    expect(Number(tombstone.deletionFence)).toBe(1);
    await ingestion.enqueue(command);

    const staleEnqueueResult = await jobs.findOneByOrFail({ documentId });
    expect(staleEnqueueResult).toMatchObject({
      cancellationReason: 'DOCUMENT_DELETED',
      status: JobStatus.CANCELLED,
    });
    expect(Number(staleEnqueueResult.deletionFence)).toBe(1);
  });

  it('không tạo MEDIA_PROBE job khi event cũ đến sau cancellation tombstone', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const command = {
      correlationId: randomUUID(),
      deletionFence: 0,
      documentId,
      fullPipelineJobId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      ownerId,
      policyVersion: 'media-v1',
      probeGeneration: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${documentId}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
    } as const;

    await ingestion.cancelDocument({
      deletionFence: 1,
      documentId,
      ownerId,
      reason: 'DOCUMENT_DELETED',
    });
    await ingestion.enqueue(command);

    await expect(mediaProbeJobs.findOneBy({ documentId })).resolves.toBeNull();
    const tombstone = await mediaProbeCancellations.findOneByOrFail({ documentId, ownerId });
    expect(Number(tombstone.deletionFence)).toBe(1);
    expect(tombstone.reason).toBe('DOCUMENT_DELETED');
  });

  it('claim job chỉ dựa trên trạng thái AI khi Document row không còn tồn tại', async () => {
    const job = await jobs.save(jobs.create({
      correlationId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      ownerId: randomUUID(),
      status: JobStatus.PENDING,
    }));

    const claimed = await new ProcessingJobRepository(ds).claimPending();

    expect(claimed).toMatchObject({
      id: job.id,
      jobType: JobType.FULL_PIPELINE,
      status: JobStatus.RUNNING,
    });
    expect(claimed?.leaseId).toEqual(expect.any(String));
    await expect(jobs.findOneByOrFail({ id: job.id })).resolves.toMatchObject({
      attempts: 1,
      status: JobStatus.RUNNING,
    });
  });

  it('không re-arm FAILED FULL_PIPELINE sau khi cancellation đã thắng', async () => {
    const command = baseCmd();
    await ingestion.enqueue(command);
    await jobs.update(
      { documentId: command.documentId },
      { status: JobStatus.FAILED },
    );

    await ingestion.cancelDocument({
      deletionFence: 1,
      documentId: command.documentId,
      ownerId: command.ownerId,
      reason: 'DOCUMENT_DELETED',
    });
    await ingestion.enqueue(command);

    await expect(jobs.findOneByOrFail({ documentId: command.documentId })).resolves.toMatchObject({
      status: JobStatus.CANCELLED,
      attempts: 0,
    });
  });

  it.each([
    ['thiếu probeGeneration', { policyVersion: 'media-v1' }],
    ['thiếu policyVersion', { probeGeneration: randomUUID() }],
  ])('từ chối MEDIA_PROBE khi %s', async (_caseName, missing) => {
    const command = {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      sourceVersionId: 'version-1',
      sourceEtag: 'etag-1',
      sourceContentLength: 1024,
      ...missing,
    };

    await expect(ingestion.enqueue(command as unknown as EnqueueCommand)).rejects.toThrow('MEDIA_PROBE requires probeGeneration');
    await expect(mediaProbeJobs.findBy({ documentId: command.documentId })).resolves.toHaveLength(0);
  });

  it('từ chối MEDIA_PROBE khi thiếu locator object bất biến', async () => {
    const command = {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      jobType: MEDIA_PROBE_JOB_TYPE,
      correlationId: randomUUID(),
      fullPipelineJobId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 0,
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
    };

    await expect(ingestion.enqueue(command as unknown as EnqueueCommand)).rejects.toThrow('immutable source locator');
    await expect(mediaProbeJobs.findBy({ documentId: command.documentId })).resolves.toHaveLength(0);
  });

  it('job đang FAILED -> re-arm về PENDING + tăng attempts và reset technical retry count', async () => {
    const cmd = baseCmd();
    await ingestion.enqueue(cmd);
    await jobs.update(
      { documentId: cmd.documentId },
      { status: JobStatus.FAILED, technicalRetryCount: 3 },
    );

    await ingestion.enqueue(cmd);

    const found = await jobs.findOneByOrFail({ documentId: cmd.documentId });
    expect(found.status).toBe(JobStatus.PENDING);
    expect(found.attempts).toBe(1);
    expect(found.technicalRetryCount).toBe(0);
  });

  it('media handoff giữ đúng logical processingAttempt khi claim lại FULL_PIPELINE', async () => {
    const fullPipelineJobId = randomUUID();
    const firstCommand = {
      ...baseCmd(),
      fullPipelineJobId,
      processingAttempt: 1,
    };

    await ingestion.enqueue(firstCommand);
    const processingJobs = new ProcessingJobRepository(ds);
    const firstClaim = await processingJobs.claimPending();
    expect(firstClaim?.attempts).toBe(1);

    await jobs.update(
      { id: firstClaim!.id },
      { status: JobStatus.FAILED, leaseId: null, leaseUntil: null },
    );

    await ingestion.enqueue({
      ...firstCommand,
      correlationId: randomUUID(),
      processingAttempt: 2,
    });

    await expect(jobs.findOneByOrFail({ id: firstClaim!.id })).resolves.toMatchObject({
      attempts: 1,
      status: JobStatus.PENDING,
    });
    const secondClaim = await processingJobs.claimPending();
    expect(secondClaim?.id).toBe(firstClaim!.id);
    expect(secondClaim?.attempts).toBe(2);
  });

  it('retry FULL_PIPELINE thay toàn bộ context probe và model trên cùng job row', async () => {
    const probeResultId = randomUUID();
    const probeGeneration = randomUUID();
    const fullPipelineJobId = randomUUID();
    const probeJob = await mediaProbeJobs.save(mediaProbeJobs.create({
      correlationId: randomUUID(),
      deletionFence: 0,
      documentId: baseDocumentId,
      fullPipelineJobId,
      idempotencyKey: randomUUID(),
      ownerId: baseOwnerId,
      policyVersion: 'media-v1',
      probeGeneration,
      sourceBucket: 'media',
      sourceKey: `media/${baseDocumentId}.mp4`,
      status: MediaProbeJobStatus.COMPLETED,
    }));
    await mediaProbeResults.save(mediaProbeResults.create({
      bucket: 'media',
      contentLength: 1024,
      deletionFence: 0,
      documentId: baseDocumentId,
      durationSec: 120,
      etag: 'etag-1',
      fullPipelineJobId,
      mediaProbeJobId: probeJob.id,
      objectKey: `media/${baseDocumentId}.mp4`,
      ownerId: baseOwnerId,
      policyVersion: 'media-v1',
      probeGeneration,
      versionId: 'version-1',
      id: probeResultId,
    }));
    const firstCommand = {
      ...baseCmd(),
      deletionFence: 0,
      fullPipelineJobId,
      policyVersion: 'media-v1',
      probeGeneration,
      probeResultId,
      selection: {
        customModelConfigId: null,
        kind: 'PLAN' as const,
        platformModelId: 'plan-v1',
      },
    };
    await ingestion.enqueue(firstCommand);
    await jobs.update(
      { documentId: firstCommand.documentId },
      { status: JobStatus.FAILED },
    );

    const nextProbeResultId = randomUUID();
    const nextProbeGeneration = randomUUID();
    const nextProbeJob = await mediaProbeJobs.save(mediaProbeJobs.create({
      correlationId: randomUUID(),
      deletionFence: 0,
      documentId: baseDocumentId,
      fullPipelineJobId,
      idempotencyKey: randomUUID(),
      ownerId: baseOwnerId,
      policyVersion: 'media-v2',
      probeGeneration: nextProbeGeneration,
      sourceBucket: 'media',
      sourceKey: `media/${baseDocumentId}.mp4`,
      status: MediaProbeJobStatus.COMPLETED,
    }));
    await mediaProbeResults.save(mediaProbeResults.create({
      bucket: 'media',
      contentLength: 1024,
      deletionFence: 0,
      documentId: baseDocumentId,
      durationSec: 180,
      etag: 'etag-2',
      fullPipelineJobId,
      mediaProbeJobId: nextProbeJob.id,
      objectKey: `media/${baseDocumentId}.mp4`,
      ownerId: baseOwnerId,
      policyVersion: 'media-v2',
      probeGeneration: nextProbeGeneration,
      versionId: 'version-2',
      id: nextProbeResultId,
    }));

    const nextCorrelationId = randomUUID();
    await ingestion.enqueue({
      ...baseCmd(),
      correlationId: nextCorrelationId,
      deletionFence: 0,
      fullPipelineJobId,
      policyVersion: 'media-v2',
      probeGeneration: nextProbeGeneration,
      probeResultId: nextProbeResultId,
      selection: {
        customModelConfigId: randomUUID(),
        kind: 'CUSTOM' as const,
        platformModelId: null,
      },
    });

    const all = await jobs.findBy({ documentId: firstCommand.documentId });
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe(JobStatus.PENDING);
    expect(all[0].attempts).toBe(1);
    expect(all[0]).toMatchObject({
      correlationId: nextCorrelationId,
      customModelConfigId: expect.any(String),
      modelSelectionKind: 'CUSTOM',
      platformModelId: null,
      policyVersion: 'media-v2',
      probeGeneration: nextProbeGeneration,
      probeResultId: nextProbeResultId,
    });
  });

  it.each([JobStatus.PENDING, JobStatus.RUNNING, JobStatus.COMPLETED])(
    'job đang %s -> no-op (không đổi status, không tăng attempts)',
    async (status) => {
      const cmd = baseCmd();
      await ingestion.enqueue(cmd);
      await jobs.update({ documentId: cmd.documentId }, { status });

      await ingestion.enqueue(cmd);

      const found = await jobs.findOneByOrFail({ documentId: cmd.documentId });
      expect(found.status).toBe(status);
      expect(found.attempts).toBe(0);
    },
  );

  async function seedMediaDocument(
    command: {
      readonly documentId: string;
      readonly ownerId: string;
      readonly probeGeneration: string;
      readonly policyVersion: string;
      readonly deletionFence: number;
      readonly sourceKey: string;
    },
    status: DocumentStatus = DocumentStatus.PROBING,
  ): Promise<void> {
    await documents.save(documents.create({
      id: command.documentId,
      ownerId: command.ownerId,
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: command.sourceKey,
      sizeBytes: 1024,
      status,
      probeGeneration: command.probeGeneration,
      probePolicyVersion: command.policyVersion,
      deletionFence: command.deletionFence,
    }));
  }
});
