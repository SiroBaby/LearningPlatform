import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { AiOutboxEvent } from './entities/ai-outbox-event.entity';
import { ProcessingJob } from './entities/processing-job.entity';
import { JobStatus } from './enums/job-status.enum';
import { JobType } from './enums/job-type.enum';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { StuckJobDetector } from './stuck-job-detector.service';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';

describe('StuckJobDetector', () => {
  let db: TestDb;
  let ds: DataSource;
  let jobs: Repository<ProcessingJob>;
  let outbox: Repository<AiOutboxEvent>;
  let detector: StuckJobDetector;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    ds = await createTestDataSource(db.container);
    jobs = ds.getRepository(ProcessingJob);
    outbox = ds.getRepository(AiOutboxEvent);
    detector = new StuckJobDetector(new ProcessingJobRepository(ds));
    await db.client.query('TRUNCATE "ai"."outbox", "ai"."processing_jobs"');
  });

  it('fails an old RUNNING job through the return outbox', async () => {
    const job = await jobs.save(
      jobs.create({
        correlationId: randomUUID(),
        documentId: randomUUID(),
        idempotencyKey: randomUUID(),
        jobType: JobType.FULL_PIPELINE,
        ownerId: randomUUID(),
        status: JobStatus.RUNNING,
      }),
    );
    await ds.query(
      'UPDATE "ai"."processing_jobs" SET "updated_at" = now() - interval \'2 minutes\' WHERE "id" = $1',
      [job.id],
    );

    expect(await detector.detectAndFail(60_000, 10)).toBe(1);
    expect((await jobs.findOneByOrFail({ id: job.id })).status).toBe(JobStatus.FAILED);
    expect((await outbox.find())[0].payload).toMatchObject({
      errorCode: 'PROCESSING_TIMED_OUT',
      errorMessage: 'Processing timed out',
      status: 'FAILED',
    });
  });
});
