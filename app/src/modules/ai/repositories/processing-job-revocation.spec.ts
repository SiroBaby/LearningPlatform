import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../../test-support/test-db';
import { DocumentProcessingFailureCode } from '../contracts/document-processing-result';
import { JobStatus } from '../enums/job-status.enum';
import { JobType } from '../enums/job-type.enum';
import { AiOutboxEvent } from '../entities/ai-outbox-event.entity';
import { ProcessingJob } from '../entities/processing-job.entity';
import { ProcessingJobRepository } from './processing-job.repository';

describe('ProcessingJobRepository account access revocation', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let jobs: Repository<ProcessingJob>;
  let outbox: Repository<AiOutboxEvent>;
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
    outbox = dataSource.getRepository(AiOutboxEvent);
    repository = new ProcessingJobRepository(dataSource);
    await db.client.query('TRUNCATE "ai"."account_access_revocations", "ai"."processing_jobs" CASCADE');
  });

  it('cancels pending and running jobs in one AI transaction and is idempotent', async () => {
    const userId = randomUUID();
    const pending = await createJob(userId, JobStatus.PENDING);
    const running = await createJob(userId, JobStatus.RUNNING);
    const completed = await createJob(userId, JobStatus.COMPLETED);
    const input = {
      eventIdempotencyKey: `${userId}:ACCOUNT_SUSPENDED`,
      reasonCode: 'ACCOUNT_SUSPENDED' as const,
      userId,
    };

    await repository.apply(input);
    await repository.apply(input);

    const cancelled = await db.client.query(
      `SELECT "id", "status", "lease_id" AS "leaseId", "cancellation_reason" AS "cancellationReason"
       FROM "ai"."processing_jobs" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"`,
      [[pending.id, running.id]],
    );
    expect(cancelled.rows).toHaveLength(2);
    expect(cancelled.rows.every((row) => row.status === 'CANCELLED' && row.leaseId === null && row.cancellationReason === 'ACCOUNT_SUSPENDED')).toBe(true);

    const completedRow = await db.client.query(
      `SELECT "status" FROM "ai"."processing_jobs" WHERE "id" = $1`,
      [completed.id],
    );
    expect(completedRow.rows[0]?.status).toBe('COMPLETED');
    expect((await db.client.query('SELECT count(*) FROM "ai"."account_access_revocations" WHERE "event_idempotency_key" = $1', [input.eventIdempotencyKey])).rows[0].count).toBe('1');
  });

  it('rejects an idempotency key reused for another identity or reason', async () => {
    const firstUserId = randomUUID();
    const eventIdempotencyKey = `${firstUserId}:ACCOUNT_SUSPENDED`;
    await repository.apply({
      eventIdempotencyKey,
      reasonCode: 'ACCOUNT_SUSPENDED',
      userId: firstUserId,
    });

    await expect(repository.apply({
      eventIdempotencyKey,
      reasonCode: 'ACCOUNT_DELETED',
      userId: randomUUID(),
    })).rejects.toThrow('Account access revocation idempotency conflict');
  });

  it('does not enqueue a stale course event after account access is revoked', async () => {
    const userId = randomUUID();
    await repository.apply({
      eventIdempotencyKey: `${userId}:ACCOUNT_DELETED`,
      reasonCode: 'ACCOUNT_DELETED',
      userId,
    });

    const documentId = randomUUID();
    await repository.enqueue({
      correlationId: randomUUID(),
      documentId,
      jobType: JobType.FULL_PIPELINE,
      ownerId: userId,
    }, randomUUID());

    await expect(jobs.findOneBy({ documentId })).resolves.toBeNull();
  });

  it('cancels a job enqueued before account access is revoked', async () => {
    const userId = randomUUID();
    const documentId = randomUUID();
    await repository.enqueue({
      correlationId: randomUUID(),
      documentId,
      jobType: JobType.FULL_PIPELINE,
      ownerId: userId,
    }, randomUUID());

    await repository.apply({
      eventIdempotencyKey: `${userId}:ACCOUNT_SUSPENDED`,
      reasonCode: 'ACCOUNT_SUSPENDED',
      userId,
    });

    await expect(jobs.findOneBy({ documentId })).resolves.toMatchObject({
      cancellationReason: 'ACCOUNT_SUSPENDED',
      cancelledAt: expect.any(Date),
      leaseId: null,
      ownerId: userId,
      status: JobStatus.CANCELLED,
    });
  });

  it('does not claim a pending job when an access revocation marker exists', async () => {
    const userId = randomUUID();
    const job = await createJob(userId, JobStatus.PENDING);
    await db.client.query(
      `INSERT INTO "ai"."account_access_revocations"
         ("user_id", "reason_code", "event_idempotency_key")
       VALUES ($1, 'ACCOUNT_DELETED', $2)`,
      [userId, `${userId}:ACCOUNT_DELETED`],
    );

    await expect(repository.claimPending()).resolves.toBeNull();
    await expect(jobs.findOneByOrFail({ id: job.id })).resolves.toMatchObject({
      attempts: 0,
      status: JobStatus.PENDING,
    });
  });

  it('includes the terminal attempt and lease fence in the result event', async () => {
    const ownerId = randomUUID();
    const leaseId = randomUUID();
    const job = await jobs.save({
      attempts: 2,
      correlationId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      leaseId,
      leaseUntil: new Date(Date.now() + 60_000),
      ownerId,
      status: JobStatus.RUNNING,
    });

    await expect(repository.complete({ id: job.id, attempts: 2, leaseId })).resolves.toBe(true);

    const event = await outbox.findOneByOrFail({ aggregateId: job.id });
    expect(event.payload).toMatchObject({ attempt: 2, leaseId });
  });

  it('does not finalize an expired matching lease', async () => {
    const ownerId = randomUUID();
    const leaseId = randomUUID();
    const job = await jobs.save({
      attempts: 2,
      correlationId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      leaseId,
      leaseUntil: new Date(Date.now() - 1_000),
      ownerId,
      status: JobStatus.RUNNING,
    });

    await expect(repository.complete({ id: job.id, attempts: 2, leaseId })).resolves.toBe(false);
    await expect(jobs.findOneByOrFail({ id: job.id })).resolves.toMatchObject({
      id: job.id,
      leaseId,
      status: JobStatus.RUNNING,
    });
    await expect(outbox.countBy({ aggregateId: job.id })).resolves.toBe(0);
  });

  it('does not rearm a completed attempt', async () => {
    const ownerId = randomUUID();
    const leaseId = randomUUID();
    const job = await jobs.save({
      attempts: 2,
      correlationId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      leaseId,
      leaseUntil: new Date(Date.now() + 60_000),
      ownerId,
      status: JobStatus.RUNNING,
    });

    await expect(repository.complete({ id: job.id, attempts: 2, leaseId })).resolves.toBe(true);
    await expect(repository.retryTechnical(
      { id: job.id, attempts: 2, leaseId },
      DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
    )).resolves.toBe(false);
    await expect(jobs.findOneByOrFail({ id: job.id })).resolves.toMatchObject({
      id: job.id,
      status: JobStatus.COMPLETED,
    });
    await expect(outbox.countBy({ aggregateId: job.id })).resolves.toBe(1);
  });

  async function createJob(ownerId: string, status: JobStatus): Promise<ProcessingJob> {
    return jobs.save({
      correlationId: randomUUID(),
      documentId: randomUUID(),
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      leaseId: status === JobStatus.RUNNING ? randomUUID() : null,
      leaseUntil: status === JobStatus.RUNNING ? new Date(Date.now() + 60_000) : null,
      ownerId,
      status,
    });
  }
});
