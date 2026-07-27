import { randomUUID } from 'crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { DataSource } from 'typeorm';

import type { ApplicationConfigService } from '../../../config/application-config.service';
import type { ChunkCandidate } from '../contracts/chunk.contracts';
import { JobStatus } from '../enums/job-status.enum';
import { ChunkRepository } from './chunk.repository';

describe('ChunkRepository', () => {
  it('inserts document replacements in configured bounded batches', async () => {
    const documentId = randomUUID();
    const jobId = randomUUID();
    const ownerId = randomUUID();
    const insert = jest.fn(async (_target: unknown, _entities: unknown[]) => undefined);
    const manager = {
      findOne: jest.fn(async () => ({
        attempts: 1,
        documentId,
        id: jobId,
        ownerId,
        status: JobStatus.RUNNING,
      })),
      insert,
      query: jest.fn(async () => undefined),
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
      ownerId,
    })).resolves.toBe(true);

    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls.map(([, batch]) => batch.length)).toEqual([2, 2, 1]);
  });
});
