import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import type { ChunkCandidate } from '../contracts/chunk.contracts';
import type { ApplicationConfigService } from '../../../config/application-config.service';
import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../../test-support/test-db';
import { ChunkRepository } from './chunk.repository';
import { ProcessingJob } from '../entities/processing-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import { JobType } from '../enums/job-type.enum';
import { ProcessingJobRepository } from './processing-job.repository';

describe('ChunkRepository', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let chunks: ChunkRepository;
  let job: ProcessingJob;
  const documentId = randomUUID();
  const ownerId = randomUUID();

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });
  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    chunks = new ChunkRepository(dataSource, {
      worker: { chunkInsertBatchSize: 2 },
    } as ApplicationConfigService);
    await db.client.query('TRUNCATE "ai"."chunks", "ai"."processing_jobs" CASCADE');
    job = await dataSource.getRepository(ProcessingJob).save({
      attempts: 1,
      correlationId: randomUUID(),
      documentId,
      idempotencyKey: randomUUID(),
      jobType: JobType.FULL_PIPELINE,
      ownerId,
      leaseId: randomUUID(),
      leaseUntil: new Date(Date.now() + 60_000),
      status: JobStatus.RUNNING,
    });
  });

  it('orders chunks and prevents cross-owner reads', async () => {
    await chunks.replaceForDocument(input([candidate(1), candidate(0)]));

    expect((await chunks.findForDocument(documentId, ownerId)).map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(await chunks.findForDocument(documentId, randomUUID())).toEqual([]);
  });

  it('replaces deterministically without duplicate rows on retry', async () => {
    const replacement = input([candidate(0), candidate(1)]);
    await chunks.replaceForDocument(replacement);
    await chunks.replaceForDocument(replacement);

    expect(await chunks.findForDocument(documentId, ownerId)).toEqual(replacement.chunks);
  });

  it('rolls back deletion if replacement fails', async () => {
    const original = candidate(0);
    await chunks.replaceForDocument(input([original]));
    await expect(chunks.replaceForDocument(input([{ ...candidate(0), text: '   ' }]))).rejects.toThrow();

    expect(await chunks.findForDocument(documentId, ownerId)).toEqual([original]);
  });

  it('inserts a replacement in configured bounded batches', async () => {
    const replacement = input([0, 1, 2, 3, 4].map(candidate));

    await expect(chunks.replaceForDocument(replacement)).resolves.toBe(true);
    expect(await chunks.findForDocument(documentId, ownerId)).toEqual(replacement.chunks);
  });

  it('does not let a stale job attempt delete or replace chunks', async () => {
    const original = candidate(0);
    await chunks.replaceForDocument(input([original]));

    await expect(chunks.replaceForDocument({
      ...input([candidate(0)]),
      attempt: job.attempts - 1,
    })).resolves.toBe(false);
    expect(await chunks.findForDocument(documentId, ownerId)).toEqual([original]);
  });

  it('fences reclaimed leases from chunk, model-selection, and budget mutations', async () => {
    const processingJobs = new ProcessingJobRepository(dataSource);
    const original = candidate(0);
    await expect(chunks.replaceForDocument(input([original]))).resolves.toBe(true);
    const workerA = { attempts: job.attempts, id: job.id, leaseId: job.leaseId! };

    await dataSource.query(
      'UPDATE "ai"."processing_jobs" SET "lease_until" = now() - interval \'1 second\' WHERE "id" = $1',
      [job.id],
    );
    const workerB = await processingJobs.claimPending();
    if (!workerB?.leaseId) throw new Error('Expected worker B to reclaim the expired lease');

    await expect(chunks.replaceForDocument({
      ...input([candidate(1)]),
      attempt: workerA.attempts,
      leaseId: workerA.leaseId,
    })).resolves.toBe(false);
    await expect(processingJobs.ensureDefaultPlatformModel({
      attempt: workerA.attempts,
      jobId: workerA.id,
      leaseId: workerA.leaseId,
      modelId: 'worker-a-model',
      ownerId,
    })).resolves.toBe(false);
    await expect(processingJobs.record({
      attempt: workerA.attempts,
      budgetStatus: 'SETTLED',
      estimatedCredits: 10,
      jobId: workerA.id,
      leaseId: workerA.leaseId,
      settledCredits: 5,
    })).resolves.toBe(false);
    expect(await chunks.findForDocument(documentId, ownerId)).toEqual([original]);

    await expect(chunks.replaceForDocument({
      ...input([candidate(1)]),
      attempt: workerB.attempts,
      jobId: workerB.id,
      leaseId: workerB.leaseId,
    })).resolves.toBe(true);
    await expect(processingJobs.ensureDefaultPlatformModel({
      attempt: workerB.attempts,
      jobId: workerB.id,
      leaseId: workerB.leaseId,
      modelId: 'worker-b-model',
      ownerId,
    })).resolves.toBe(true);
    await expect(processingJobs.record({
      attempt: workerB.attempts,
      budgetStatus: 'SETTLED',
      estimatedCredits: 10,
      jobId: workerB.id,
      leaseId: workerB.leaseId,
      settledCredits: 5,
    })).resolves.toBe(true);

    expect(await chunks.findForDocument(documentId, ownerId)).toEqual([
      expect.objectContaining({ chunkIndex: 1 }),
    ]);
    await expect(dataSource.getRepository(ProcessingJob).findOneByOrFail({ id: job.id })).resolves.toMatchObject({
      budgetStatus: 'SETTLED',
      estimatedCredits: '10',
      modelSelectionKind: 'PLAN',
      platformModelId: 'worker-b-model',
      settledCredits: '5',
    });
  });

  function input(chunkCandidates: ChunkCandidate[]) {
    return {
      attempt: job.attempts,
      chunks: chunkCandidates,
      documentId,
      jobId: job.id,
      leaseId: job.leaseId!,
      ownerId,
    };
  }

  function candidate(chunkIndex: number): ChunkCandidate {
    const text = `chunk ${chunkIndex}`;
    return {
      chunkIndex,
      contentHash: `${chunkIndex}`.padStart(64, '0'),
      id: randomUUID(),
      locator: { kind: 'page', page: chunkIndex + 1 },
      text,
    };
  }
});
