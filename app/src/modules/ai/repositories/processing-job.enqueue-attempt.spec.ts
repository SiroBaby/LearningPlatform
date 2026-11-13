import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../../test-support/test-db';
import type { FullPipelineEnqueueCommand } from '../contracts/ai-ingestion.port';
import { ProcessingJob } from '../entities/processing-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import { JobType } from '../enums/job-type.enum';
import { ProcessingJobRepository } from './processing-job.repository';

const IDEMPOTENCY_KEY = 'b'.repeat(64);

describe('ProcessingJobRepository.enqueue processing attempt (#275)', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let jobs: Repository<ProcessingJob>;
  let repository: ProcessingJobRepository;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    jobs = dataSource.getRepository(ProcessingJob);
    repository = new ProcessingJobRepository(dataSource);
    await db.client.query('TRUNCATE "ai"."account_access_revocations", "ai"."processing_jobs" CASCADE');
  });

  function buildCommand(overrides: Partial<FullPipelineEnqueueCommand> = {}): FullPipelineEnqueueCommand {
    return {
      correlationId: randomUUID(),
      deletionFence: 0,
      documentId: randomUUID(),
      fullPipelineJobId: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      ownerId: randomUUID(),
      processingAttempt: 1,
      ...overrides,
    };
  }

  async function findJob(documentId: string): Promise<ProcessingJob> {
    return jobs.findOneByOrFail({ documentId, jobType: JobType.FULL_PIPELINE });
  }

  it('records the Document processing attempt when the job is first inserted', async () => {
    const inputCommand = buildCommand({ processingAttempt: 3 });

    await repository.enqueue(inputCommand, IDEMPOTENCY_KEY);

    const actualJob = await findJob(inputCommand.documentId);
    expect(actualJob).toMatchObject({ attempts: 2, id: inputCommand.fullPipelineJobId, processingAttempt: 3 });
  });

  it('leaves the processing attempt unknown when the producer did not send one', async () => {
    const inputCommand = buildCommand({ processingAttempt: undefined });

    await repository.enqueue(inputCommand, IDEMPOTENCY_KEY);

    expect((await findJob(inputCommand.documentId)).processingAttempt).toBeNull();
  });

  it('moves the processing attempt forward when a FAILED job is re-armed for a retry', async () => {
    const firstCommand = buildCommand({ processingAttempt: 1 });
    await repository.enqueue(firstCommand, IDEMPOTENCY_KEY);
    await db.client.query(
      `UPDATE "ai"."processing_jobs" SET "status" = 'FAILED', "attempts" = 2 WHERE "document_id" = $1`,
      [firstCommand.documentId],
    );

    await repository.enqueue({ ...firstCommand, processingAttempt: 3 }, IDEMPOTENCY_KEY);

    expect(await findJob(firstCommand.documentId)).toMatchObject({
      attempts: 2,
      processingAttempt: 3,
      status: JobStatus.PENDING,
    });
  });

  it('keeps the recorded attempt when a replayed forward event does not re-arm the job', async () => {
    const inputCommand = buildCommand({ processingAttempt: 2 });
    await repository.enqueue(inputCommand, IDEMPOTENCY_KEY);

    await repository.enqueue({ ...inputCommand, processingAttempt: 5 }, IDEMPOTENCY_KEY);

    expect(await findJob(inputCommand.documentId)).toMatchObject({ attempts: 1, processingAttempt: 2, status: JobStatus.PENDING });
  });
});
