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
import { AiIngestionService } from './ai-ingestion.service';
import { ProcessingJob } from './entities/processing-job.entity';
import { JobStatus } from './enums/job-status.enum';
import { JobType } from './enums/job-type.enum';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

// Deep module quan trọng nhất (ADR-0012/0019): upsert idempotent.
describe('AiIngestionService.enqueue', () => {
  let db: TestDb;
  let ds: DataSource;
  let jobs: Repository<ProcessingJob>;
  let ingestion: AiIngestionService;

  const baseCmd = () => ({
    documentId: randomUUID(),
    ownerId: randomUUID(),
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
    ingestion = new AiIngestionService(new ProcessingJobRepository(ds));
    await db.client.query('TRUNCATE "ai"."processing_jobs"');
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

  it('job đang FAILED -> re-arm về PENDING + tăng attempts', async () => {
    const cmd = baseCmd();
    await ingestion.enqueue(cmd);
    await jobs.update(
      { documentId: cmd.documentId },
      { status: JobStatus.FAILED },
    );

    await ingestion.enqueue(cmd);

    const found = await jobs.findOneByOrFail({ documentId: cmd.documentId });
    expect(found.status).toBe(JobStatus.PENDING);
    expect(found.attempts).toBe(1);
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
});
