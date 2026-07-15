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

  function input(chunkCandidates: ChunkCandidate[]) {
    return {
      attempt: job.attempts,
      chunks: chunkCandidates,
      documentId,
      jobId: job.id,
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
