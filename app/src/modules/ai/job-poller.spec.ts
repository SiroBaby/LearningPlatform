import { randomUUID } from 'crypto';

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
import { JobPoller } from './job-poller.service';
import { ProcessingJob } from './entities/processing-job.entity';
import { JobStatus } from './enums/job-status.enum';
import { JobType } from './enums/job-type.enum';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

// Poller của ai: nhặt PENDING -> RUNNING -> (no-op pipeline) -> COMPLETED.
// Pipeline thật (extract/chunk/generate) đến ở issue 03-05; ở đây là placeholder.
describe('JobPoller.tick', () => {
  let db: TestDb;
  let ds: DataSource;
  let jobs: Repository<ProcessingJob>;
  let poller: JobPoller;

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
    poller = new JobPoller(new ProcessingJobRepository(ds));
    await db.client.query('TRUNCATE "ai"."processing_jobs"');
  });

  async function seedPending(): Promise<string> {
    const job = await jobs.save(
      jobs.create({
        documentId: randomUUID(),
        ownerId: randomUUID(),
        jobType: JobType.FULL_PIPELINE,
        status: JobStatus.PENDING,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
      }),
    );
    return job.id;
  }

  it('nhặt job PENDING -> COMPLETED (no-op pipeline)', async () => {
    const id = await seedPending();

    await poller.tick();

    const done = await jobs.findOneByOrFail({ id });
    expect(done.status).toBe(JobStatus.COMPLETED);
  });

  it('không có job PENDING -> no-op, không lỗi', async () => {
    await expect(poller.tick()).resolves.toBeUndefined();
  });

  it('không đụng job đã COMPLETED', async () => {
    const id = await seedPending();
    await poller.tick();
    const first = await jobs.findOneByOrFail({ id });

    await poller.tick();

    const second = await jobs.findOneByOrFail({ id });
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
  });
});
