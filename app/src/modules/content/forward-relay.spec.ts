import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { AiIngestionService } from '../ai/ai-ingestion.service';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { ProcessingJobRepository } from '../ai/repositories/processing-job.repository';
import { ForwardRelay } from './forward-relay.service';
import { OutboxEvent } from './entities/outbox-event.entity';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';

// Forward seam content -> ai (ADR-0002/0012/0019): at-least-once.
describe('ForwardRelay.pump', () => {
  let db: TestDb;
  let ds: DataSource;
  let outbox: Repository<OutboxEvent>;
  let jobs: Repository<ProcessingJob>;
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
    relay = new ForwardRelay(
      new CourseOutboxRepository(ds),
      new AiIngestionService(new ProcessingJobRepository(ds)),
    );
    await db.client.query(
      'TRUNCATE "course"."outbox", "ai"."processing_jobs"',
    );
  });

  async function seedOutbox(): Promise<{ documentId: string; ownerId: string }> {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    await outbox.insert({
      aggregateId: documentId,
      eventType: 'DocumentReadyForProcessing',
      payload: { documentId, ownerId, jobType: 'FULL_PIPELINE' },
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

  it('keeps the course outbox unpublished when ingestion fails, then replays once', async () => {
    const { documentId } = await seedOutbox();
    const failingRelay = new ForwardRelay(
      new CourseOutboxRepository(ds),
      { enqueue: async () => { throw new Error('queue unavailable'); } },
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
});
