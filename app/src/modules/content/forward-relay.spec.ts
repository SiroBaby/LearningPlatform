import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { AiIngestionService } from '../ai/ai-ingestion.service';
import { MEDIA_PROBE_JOB_TYPE } from '../ai/contracts/ai-ingestion.port';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { MediaProbeJob } from '../ai/entities/media-probe-job.entity';
import { JobType } from '../ai/enums/job-type.enum';
import { JobStatus } from '../ai/enums/job-status.enum';
import { MediaProbeJobStatus } from '../ai/enums/media-probe-job-status.enum';
import { ProcessingJobRepository } from '../ai/repositories/processing-job.repository';
import { MediaProbeJobRepository } from '../ai/repositories/media-probe-job.repository';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ForwardRelay } from './forward-relay.service';
import { OutboxEvent } from './entities/outbox-event.entity';
import { ContentRepository } from './repositories/content.repository';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';

// Forward seam content -> ai (ADR-0002/0012/0019): at-least-once.
describe('ForwardRelay.pump', () => {
  let db: TestDb;
  let ds: DataSource;
  let outbox: Repository<OutboxEvent>;
  let jobs: Repository<ProcessingJob>;
  let mediaProbeJobs: Repository<MediaProbeJob>;
  let documents: Repository<Document>;
  let relay: ForwardRelay;

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
    outbox = ds.getRepository(OutboxEvent);
    jobs = ds.getRepository(ProcessingJob);
    mediaProbeJobs = ds.getRepository(MediaProbeJob);
    documents = ds.getRepository(Document);
    relay = new ForwardRelay(
      new CourseOutboxRepository(ds),
      new ContentRepository(ds),
      new AiIngestionService(new ProcessingJobRepository(ds), new MediaProbeJobRepository(ds)),
    );
    await db.client.query(
      'TRUNCATE "course"."outbox", "course"."documents", "ai"."processing_jobs", "ai"."media_probe_cancellation_tombstones", "ai"."media_probe_jobs" CASCADE',
    );
  });

  async function seedOutbox(): Promise<{ documentId: string; ownerId: string }> {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.TEXT,
      originalName: 'fixture.txt',
      storageRef: `fixtures/${documentId}.txt`,
      sizeBytes: 1024,
      status: DocumentStatus.PROCESSING,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentReadyForProcessing',
      payload: { documentId, ownerId, jobType: 'FULL_PIPELINE', deletionFence: 0 },
      publishedAt: null,
    });
    return { documentId, ownerId };
  }

  it('đọc outbox chưa publish -> tạo job PENDING + đánh dấu published', async () => {
    const { documentId, ownerId } = await seedOutbox();

    await relay.pump(100);

    const job = await jobs.findOneByOrFail({ documentId });
    expect(job.ownerId).toBe(ownerId); // owner_id qua data plane (ADR-0018)
    const row = await outbox.findOneByOrFail({ aggregateId: documentId });
    expect(row.publishedAt).not.toBeNull();
  });

  it('at-least-once: pump 2 lần -> vẫn 1 job (enqueue idempotent)', async () => {
    const { documentId } = await seedOutbox();

    await relay.pump(100);
    await relay.pump(100);

    const all = await jobs.findBy({ documentId });
    expect(all).toHaveLength(1);
  });

  it('chuyển processingAttempt của media handoff để claim dùng đúng attempt logic', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const fullPipelineJobId = randomUUID();
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: `media/${documentId}.mp4`,
      sizeBytes: 1024,
      status: DocumentStatus.PROCESSING,
      processingAttempt: 2,
      fullPipelineJobId,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentReadyForProcessing',
      payload: {
        documentId,
        ownerId,
        jobType: 'FULL_PIPELINE',
        fullPipelineJobId,
        processingAttempt: 2,
        deletionFence: 0,
      },
      publishedAt: null,
    });

    await relay.pump(100);

    const repository = new ProcessingJobRepository(ds);
    await expect(jobs.findOneByOrFail({ documentId })).resolves.toMatchObject({
      id: fullPipelineJobId,
      attempts: 1,
      status: JobStatus.PENDING,
    });
    await expect(repository.claimPending()).resolves.toMatchObject({
      id: fullPipelineJobId,
      attempts: 2,
      status: JobStatus.RUNNING,
    });
  });

  it('keeps the course outbox unpublished when ingestion fails, then replays once', async () => {
    const { documentId } = await seedOutbox();
    const failingRelay = new ForwardRelay(
      new CourseOutboxRepository(ds),
      new ContentRepository(ds),
      {
        cancelDocument: async () => undefined,
        enqueue: async () => { throw new Error('queue unavailable'); },
      },
    );

    await expect(failingRelay.pump(100)).rejects.toThrow('queue unavailable');
    expect((await outbox.findOneByOrFail({ aggregateId: documentId })).publishedAt).toBeNull();
    expect(await jobs.findBy({ documentId })).toHaveLength(0);

    await relay.pump(100);
    await relay.pump(100);

    expect((await outbox.findOneByOrFail({ aggregateId: documentId })).publishedAt).not.toBeNull();
    expect(await jobs.findBy({ documentId })).toHaveLength(1);
  });

  it('chỉ xử lý row chưa publish (đã publish -> bỏ qua)', async () => {
    const { documentId } = await seedOutbox();
    await relay.pump(100);
    const before = (await jobs.findBy({ documentId })).length;

    await relay.pump(100); // row đã published, không enqueue lại

    const after = (await jobs.findBy({ documentId })).length;
    expect(after).toBe(before);
  });

  it('ack stale DocumentReadyForProcessing sau khi Document đã bị xóa mà không tạo job AI', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.TEXT,
      originalName: 'deleted.txt',
      storageRef: `fixtures/${documentId}.txt`,
      sizeBytes: 1024,
      status: DocumentStatus.DELETING,
      deletionFence: 1,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentReadyForProcessing',
      payload: { documentId, ownerId, jobType: 'FULL_PIPELINE', deletionFence: 0 },
      publishedAt: null,
    });

    await relay.pump(100);

    await expect(jobs.findBy({ documentId })).resolves.toHaveLength(0);
    await expect(outbox.findOneByOrFail({ aggregateId: documentId })).resolves.toMatchObject({
      publishedAt: expect.any(Date),
    });
  });

  it('ack stale DocumentProbeRequested khi deletion fence đã tăng mà không tạo media probe job', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const probeGeneration = randomUUID();
    const fullPipelineJobId = randomUUID();
    const sourceKey = `media/${documentId}.mp4`;
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.VIDEO,
      originalName: 'deleted.mp4',
      storageRef: sourceKey,
      sizeBytes: 1024,
      status: DocumentStatus.DELETING,
      deletionFence: 1,
      probeGeneration,
      probePolicyVersion: 'media-v1',
      fullPipelineJobId,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentProbeRequested',
      payload: {
        documentId,
        ownerId,
        jobType: MEDIA_PROBE_JOB_TYPE,
        deletionFence: 0,
        fullPipelineJobId,
        probeGeneration,
        policyVersion: 'media-v1',
        sourceBucket: 'media',
        sourceKey,
        sourceVersionId: 'version-1',
        sourceEtag: 'etag-1',
        sourceContentLength: 1024,
      },
      publishedAt: null,
    });

    await relay.pump(100);

    await expect(mediaProbeJobs.findBy({ documentId })).resolves.toHaveLength(0);
    await expect(outbox.findOneByOrFail({ aggregateId: documentId })).resolves.toMatchObject({
      publishedAt: expect.any(Date),
    });
  });

  it('chuyển metadata bất biến của MEDIA_PROBE sang bảng media probe riêng', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const probeGeneration = randomUUID();
    const fullPipelineJobId = randomUUID();
    const sourceKey = `media/${randomUUID()}.mp4`;
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: sourceKey,
      sizeBytes: 1024,
      status: DocumentStatus.PROBING,
      probeGeneration,
      probePolicyVersion: 'media-v1',
      deletionFence: 0,
      fullPipelineJobId,
      processingAttempt: 1,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentProbeRequested',
      payload: {
        documentId,
        ownerId,
        jobType: MEDIA_PROBE_JOB_TYPE,
        probeGeneration,
        policyVersion: 'media-v1',
        deletionFence: 0,
        fullPipelineJobId,
        processingAttempt: 1,
        sourceBucket: 'media',
        sourceKey,
        sourceVersionId: 'version-1',
        sourceEtag: 'etag-1',
        sourceContentLength: 1024,
      },
      publishedAt: null,
    });

    await relay.pump(100);

    const job = await mediaProbeJobs.findOneByOrFail({ documentId });
    expect(job.probeGeneration).toBe(probeGeneration);
    expect(job.policyVersion).toBe('media-v1');
    expect(Number(job.deletionFence)).toBe(0);
    expect(job.sourceVersionId).toBe('version-1');
    expect(job.sourceEtag).toBe('etag-1');
    expect(Number(job.sourceContentLength)).toBe(1024);
  });

  it('ack stale DocumentProbeRequested khi probeGeneration đã đổi mà không tạo media probe job', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    const staleGeneration = randomUUID();
    const currentGeneration = randomUUID();
    const fullPipelineJobId = randomUUID();
    const sourceKey = `media/${documentId}.mp4`;
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: sourceKey,
      sizeBytes: 1024,
      status: DocumentStatus.PROBING,
      deletionFence: 0,
      probeGeneration: currentGeneration,
      probePolicyVersion: 'media-v2',
      fullPipelineJobId,
      processingAttempt: 2,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentProbeRequested',
      payload: {
        documentId,
        ownerId,
        jobType: MEDIA_PROBE_JOB_TYPE,
        deletionFence: 0,
        fullPipelineJobId,
        processingAttempt: 1,
        probeGeneration: staleGeneration,
        policyVersion: 'media-v1',
        sourceBucket: 'media',
        sourceKey,
        sourceVersionId: 'version-1',
        sourceEtag: 'etag-1',
        sourceContentLength: 1024,
      },
      publishedAt: null,
    });

    await relay.pump(100);

    await expect(mediaProbeJobs.findBy({ documentId })).resolves.toHaveLength(0);
    await expect(outbox.findOneByOrFail({ aggregateId: documentId })).resolves.toMatchObject({
      publishedAt: expect.any(Date),
    });
  });

  it('chuyển cancellation của Document qua outbox và giữ nguyên deletion fence của job', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    await documents.save(documents.create({
      id: documentId,
      ownerId,
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: `media/${documentId}.mp4`,
      sizeBytes: 1024,
      status: DocumentStatus.DELETING,
      deletionFence: 4,
    }));
    const job = await mediaProbeJobs.save(mediaProbeJobs.create({
      documentId,
      ownerId,
      correlationId: randomUUID(),
      probeGeneration: randomUUID(),
      policyVersion: 'media-v1',
      deletionFence: 3,
      fullPipelineJobId: randomUUID(),
      sourceBucket: 'media',
      sourceKey: `media/${randomUUID()}.mp4`,
      status: MediaProbeJobStatus.RUNNING,
      idempotencyKey: randomUUID(),
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000),
    }));
    const processingJob = await jobs.save(jobs.create({
      documentId,
      ownerId,
      correlationId: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      status: JobStatus.RUNNING,
      idempotencyKey: randomUUID(),
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000),
      deletionFence: 3,
    }));
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentProcessingCancelled',
      payload: {
        documentId,
        ownerId,
        deletionFence: 4,
        reason: 'DOCUMENT_DELETED',
        version: 1,
      },
      publishedAt: null,
    });

    await relay.pump(100);

    const cancelledProbeJob = await mediaProbeJobs.findOneByOrFail({ id: job.id });
    expect(cancelledProbeJob).toMatchObject({
      status: MediaProbeJobStatus.CANCELLED,
      leaseId: null,
      leaseUntil: null,
    });
    expect(Number(cancelledProbeJob.deletionFence)).toBe(3);
    const cancelledProcessingJob = await jobs.findOneByOrFail({ id: processingJob.id });
    expect(cancelledProcessingJob).toMatchObject({
      status: JobStatus.CANCELLED,
      leaseId: null,
      leaseUntil: null,
    });
    expect(Number(cancelledProcessingJob.deletionFence)).toBe(3);
    await expect(outbox.findOneByOrFail({ aggregateId: documentId, eventType: 'DocumentProcessingCancelled' })).resolves.toMatchObject({
      publishedAt: expect.any(Date),
    });
  });
});
