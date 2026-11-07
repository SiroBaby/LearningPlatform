import { randomUUID } from 'crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import type { ApplicationConfigService } from '../../../config/application-config.service';
import type { ChunkCandidate } from '../contracts/chunk.contracts';
import { ChunkRepository } from './chunk.repository';

describe('ChunkRepository', () => {
  it('inserts document replacements in configured bounded batches', async () => {
    const documentId = randomUUID();
    const jobId = randomUUID();
    const ownerId = randomUUID();
    const insert = jest.fn(async (_target: unknown, _entities: unknown[]) => undefined);
    const manager = {
      insert,
      query: jest.fn(async (sql: string) => (
        sql.includes('SELECT "id"') ? [{ id: jobId }] : undefined
      )),
    };
    const dataSource = {
      createEntityManager: () => ({}),
      transaction: async <T>(callback: (transactionManager: typeof manager) => Promise<T>) =>
        callback(manager),
    } as unknown as DataSource;
    const repository = new ChunkRepository(dataSource, {
      worker: { chunkInsertBatchSize: 2 },
    } as ApplicationConfigService);
    const candidates = [0, 1, 2, 3, 4].map((chunkIndex): ChunkCandidate => ({
      chunkIndex,
      contentHash: `${chunkIndex}`.padStart(64, '0'),
      id: randomUUID(),
      locator: { kind: 'page', page: chunkIndex + 1 },
      text: `chunk ${chunkIndex}`,
    }));

    await expect(repository.replaceForDocument({
      attempt: 1,
      chunks: candidates,
      documentId,
      jobId,
      leaseId: randomUUID(),
      ownerId,
    })).resolves.toBe(true);

    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls.map(([, batch]) => batch.length)).toEqual([2, 2, 1]);
  });

  it('persists time locators as start_sec and end_sec and leaves page rows untouched', async () => {
    const jobId = randomUUID();
    const insert = jest.fn(async (_target: unknown, _entities: unknown[]) => undefined);
    const manager = {
      insert,
      query: jest.fn(async (sql: string) => (
        sql.includes('SELECT "id"') ? [{ id: jobId }] : undefined
      )),
    };
    const dataSource = {
      createEntityManager: () => ({}),
      transaction: async <T>(callback: (transactionManager: typeof manager) => Promise<T>) =>
        callback(manager),
    } as unknown as DataSource;
    const repository = new ChunkRepository(dataSource);
    const candidates: ChunkCandidate[] = [
      {
        chunkIndex: 0,
        contentHash: '0'.padStart(64, '0'),
        id: randomUUID(),
        locator: { kind: 'time', startSec: 0, endSec: 12.02 },
        text: 'Xin chào các bạn',
      },
      {
        chunkIndex: 1,
        contentHash: '1'.padStart(64, '0'),
        id: randomUUID(),
        locator: { kind: 'page', page: 3 },
        text: 'page chunk',
      },
    ];

    await repository.replaceForDocument({
      attempt: 1,
      chunks: candidates,
      documentId: randomUUID(),
      jobId,
      leaseId: randomUUID(),
      ownerId: randomUUID(),
    });

    const rows = insert.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ pageNumber: null, startSec: '0.000', endSec: '12.020' });
    expect(rows[1]).toMatchObject({ pageNumber: 3, startSec: null, endSec: null });
  });
});
