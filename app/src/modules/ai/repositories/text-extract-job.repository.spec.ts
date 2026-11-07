import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../../test-support/test-db';
import { TEXT_EXTRACT_JOB_TYPE, type TextExtractEnqueueCommand } from '../contracts/ai-ingestion.port';
import { ProcessingJob } from '../entities/processing-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import { ProcessingJobRepository } from './processing-job.repository';

const IDEMPOTENCY_KEY = 'a'.repeat(64);

describe('ProcessingJobRepository TEXT_EXTRACT jobs (ADR-0033)', () => {
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

  function buildCommand(overrides: Partial<TextExtractEnqueueCommand> = {}): TextExtractEnqueueCommand {
    return {
      correlationId: randomUUID(),
      deletionFence: 0,
      documentId: randomUUID(),
      fullPipelineJobId: randomUUID(),
      jobType: TEXT_EXTRACT_JOB_TYPE,
      ownerId: randomUUID(),
      processingAttempt: 1,
      ...overrides,
    };
  }

  async function findExtractJob(documentId: string): Promise<ProcessingJob | null> {
    return jobs.findOne({ where: { documentId, jobType: TEXT_EXTRACT_JOB_TYPE as never } });
  }

  it('creates one pending job whose first claim lands on the Document attempt', async () => {
    const inputCommand = buildCommand({ processingAttempt: 4 });

    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);

    const actualJob = await findExtractJob(inputCommand.documentId);
    expect(actualJob).toMatchObject({
      attempts: 3,
      fullPipelineJobId: inputCommand.fullPipelineJobId,
      processingAttempt: 4,
      status: JobStatus.PENDING,
    });
  });

  it('does not re-arm a replayed forward event, even after the job completed', async () => {
    const inputCommand = buildCommand({ processingAttempt: 2 });
    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);
    await db.client.query(
      `UPDATE "ai"."processing_jobs" SET "status" = 'COMPLETED', "attempts" = 2 WHERE "document_id" = $1`,
      [inputCommand.documentId],
    );

    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);

    expect(await findExtractJob(inputCommand.documentId)).toMatchObject({ attempts: 2, status: JobStatus.COMPLETED });
  });

  it('re-arms a finished job for a newer Document attempt even when technical retries raised its attempts', async () => {
    const firstCommand = buildCommand({ processingAttempt: 1 });
    await repository.enqueueTextExtract(firstCommand, IDEMPOTENCY_KEY);
    await db.client.query(
      `UPDATE "ai"."processing_jobs" SET "status" = 'FAILED', "attempts" = 5 WHERE "document_id" = $1`,
      [firstCommand.documentId],
    );
    const retryCommand = { ...firstCommand, fullPipelineJobId: randomUUID(), processingAttempt: 2 };

    await repository.enqueueTextExtract(retryCommand, IDEMPOTENCY_KEY);

    expect(await findExtractJob(firstCommand.documentId)).toMatchObject({
      attempts: 1,
      fullPipelineJobId: retryCommand.fullPipelineJobId,
      processingAttempt: 2,
      status: JobStatus.PENDING,
    });
  });

  it('does not touch a job that is still running', async () => {
    const inputCommand = buildCommand();
    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);
    await db.client.query(`UPDATE "ai"."processing_jobs" SET "status" = 'RUNNING' WHERE "document_id" = $1`, [inputCommand.documentId]);

    await repository.enqueueTextExtract({ ...inputCommand, processingAttempt: 2 }, IDEMPOTENCY_KEY);

    expect(await findExtractJob(inputCommand.documentId)).toMatchObject({ processingAttempt: 1, status: JobStatus.RUNNING });
  });

  it('creates nothing for an Owner whose account access was revoked', async () => {
    const inputCommand = buildCommand();
    await db.client.query(
      `INSERT INTO "ai"."account_access_revocations" ("user_id", "reason_code", "event_idempotency_key") VALUES ($1, 'ACCOUNT_SUSPENDED', $2)`,
      [inputCommand.ownerId, `${inputCommand.ownerId}:ACCOUNT_SUSPENDED`],
    );

    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);

    expect(await findExtractJob(inputCommand.documentId)).toBeNull();
  });

  it('cancels the extraction on deletion and leaves tombstones that block a stale enqueue', async () => {
    const inputCommand = buildCommand();
    await repository.enqueueTextExtract(inputCommand, IDEMPOTENCY_KEY);
    await db.client.query(
      `UPDATE "ai"."processing_jobs" SET "status" = 'RUNNING', "lease_id" = gen_random_uuid(), "lease_until" = now() + interval '1 minute' WHERE "document_id" = $1`,
      [inputCommand.documentId],
    );

    await repository.cancelDocument({
      deletionFence: 1,
      documentId: inputCommand.documentId,
      ownerId: inputCommand.ownerId,
      reason: 'DOCUMENT_DELETED',
    });
    await repository.enqueueTextExtract({ ...inputCommand, deletionFence: 1, processingAttempt: 2 }, IDEMPOTENCY_KEY);

    const actualJobs = await jobs.find({ where: { documentId: inputCommand.documentId } });
    expect(actualJobs.map((job) => `${job.jobType}:${job.status}`).sort()).toEqual([
      'FULL_PIPELINE:CANCELLED',
      'TEXT_EXTRACT:CANCELLED',
    ]);
    expect(actualJobs.find((job) => job.jobType === ('TEXT_EXTRACT' as never))).toMatchObject({
      leaseId: null,
      leaseUntil: null,
    });
  });
});
