import { describe, expect, it, jest } from '@jest/globals';

import { AuthRepository } from './repositories/auth.repository';

const transactionRow = {
  id: 'tx-1',
  state_hash: 'state-hash',
  nonce_hash: 'nonce-hash',
  pkce_verifier_ciphertext: Buffer.from('ciphertext'),
  environment: 'test',
  max_attempts: 5,
  attempt_count: 1,
  expires_at: new Date(),
  processing_at: new Date(),
  consumed_at: null,
  failed_at: null,
  created_at: new Date(),
};

describe('AuthRepository OAuth reservation', () => {
  it('atomically reserves only an unexpired, unconsumed transaction', async () => {
    const manager = {
      query: jest.fn(async () => [transactionRow]),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({ id: 'tx-1' });
    const claimSql = (manager.query as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(claimSql).toContain('"expires_at" > now()');
    expect(claimSql).toContain('"processing_at" IS NULL');
    expect(claimSql).toContain('"consumed_at" IS NULL');
    expect(claimSql).toContain('"attempt_count" < "max_attempts"');
  });

  it('supports query runners that return rows inside a result object', async () => {
    const manager = {
      query: jest.fn(async () => ({ rows: [transactionRow] })),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({
      id: 'tx-1',
      stateHash: 'state-hash',
    });
  });

  it('supports query runners that return a rows and row-count tuple', async () => {
    const manager = {
      query: jest.fn(async () => [[transactionRow], 1]),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({ id: 'tx-1' });
  });

  it('marks retry exhaustion as failed when atomic reservation finds no eligible row', async () => {
    const manager = { query: jest.fn(async () => []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toBeNull();
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect((manager.query as unknown as jest.Mock).mock.calls[1][0] as string).toContain('"failed_at" = COALESCE');
  });

  it('allows only one of concurrent reservations to win', async () => {
    let reservation = true;
    const makeManager = () => ({
      query: jest.fn(async () => {
        if (!reservation) return [];
        reservation = false;
        return [transactionRow];
      }),
    });
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: ReturnType<typeof makeManager>) => unknown) => callback(makeManager())),
    };
    const repository = new AuthRepository(dataSource as never);

    const results = await Promise.all([
      repository.beginOAuthExchange('state-hash', 'test'),
      repository.beginOAuthExchange('state-hash', 'test'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('releases a failed reservation with an explicit null update', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      query: jest.fn(async () => [{ id: 'tx-1' }]),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.releaseOAuthTransaction('tx-1');
    expect(dataSource.query as unknown as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('SET "processing_at" = NULL'), ['tx-1']);
    expect(dataSource.query as unknown as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('"consumed_at" IS NULL'), ['tx-1']);
  });
});
