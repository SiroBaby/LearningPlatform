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
import { JobProcessor } from './contracts/job-processor.port';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { AiOutboxEvent } from './entities/ai-outbox-event.entity';
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
  let outbox: Repository<AiOutboxEvent>;
  let poller: JobPoller;
  let processor: JobProcessor;

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
    outbox = ds.getRepository(AiOutboxEvent);
    processor = { process: async () => undefined };
    poller = new JobPoller(new ProcessingJobRepository(ds), processor);
    await db.client.query('TRUNCATE "ai"."outbox", "ai"."processing_jobs"');
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

  it('nhặt job PENDING -> COMPLETED cùng return event READY', async () => {
    const id = await seedPending();

    await poller.tick();

    const done = await jobs.findOneByOrFail({ id });
    expect(done.status).toBe(JobStatus.COMPLETED);
    expect(await outbox.find()).toHaveLength(1);
    expect((await outbox.find())[0].payload).toMatchObject({ status: 'READY', version: 1 });
  });

  it('processor lỗi -> FAILED cùng return event đã redact', async () => {
    processor = {
      process: async () => {
        throw new Error('s3://private-bucket/secret.pdf');
      },
    };
    poller = new JobPoller(new ProcessingJobRepository(ds), processor);
    const id = await seedPending();

    await poller.tick();

    expect((await jobs.findOneByOrFail({ id })).status).toBe(JobStatus.FAILED);
    expect((await outbox.find())[0].payload).toMatchObject({
      errorCode: 'PROCESSING_FAILED',
      errorMessage: 'Processing failed',
      status: 'FAILED',
    });
    expect(JSON.stringify((await outbox.find())[0].payload)).not.toContain(
      'private-bucket',
    );
  });

  it('extractor failure -> FAILED with its safe structured code', async () => {
    processor = {
      process: async () => {
        throw new ExtractionError(DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND);
      },
    };
    poller = new JobPoller(new ProcessingJobRepository(ds), processor);
    const id = await seedPending();

    await poller.tick();

    expect((await jobs.findOneByOrFail({ id })).status).toBe(JobStatus.FAILED);
    expect((await outbox.find())[0].payload).toMatchObject({
      errorCode: 'PDF_TEXT_NOT_FOUND',
      errorMessage: 'Uploaded PDF has no extractable text layer',
      status: 'FAILED',
    });
  });

  it('rolls back the final job state when its return outbox write fails', async () => {
    const id = await seedPending();
    const processingJobs = new ProcessingJobRepository(ds);
    await processingJobs.claimPending();
    await ds.query(`
      CREATE FUNCTION "ai"."reject_return_outbox"() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced outbox failure'; END; $$;
      CREATE TRIGGER "reject_return_outbox_insert"
      BEFORE INSERT ON "ai"."outbox"
      FOR EACH ROW EXECUTE FUNCTION "ai"."reject_return_outbox"();
    `);

    try {
      await expect(processingJobs.complete(id)).rejects.toThrow(
        'forced outbox failure',
      );
    } finally {
      await ds.query(`
        DROP TRIGGER IF EXISTS "reject_return_outbox_insert" ON "ai"."outbox";
        DROP FUNCTION IF EXISTS "ai"."reject_return_outbox"();
      `);
    }

    expect((await jobs.findOneByOrFail({ id })).status).toBe(JobStatus.RUNNING);
    expect(await outbox.find()).toHaveLength(0);
  });

  it('không có job PENDING -> no-op, không lỗi', async () => {
    await expect(poller.tick()).resolves.toBe(false);
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
