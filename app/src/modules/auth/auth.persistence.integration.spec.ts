import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { startTestDatabase, stopTestDatabase, type TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { OAuthTransaction } from './entities/oauth-transaction.entity';
import { Session } from './entities/session.entity';
import { AccountStatus } from './enums/account-status.enum';
import { AuthRepository } from './repositories/auth.repository';
import { hashOAuthValue } from './oauth-crypto';

describe('AuthRepository PostgreSQL lifecycle', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let repository: AuthRepository;

  beforeAll(async () => {
    db = await startTestDatabase();
    dataSource = await createTestDataSource(db.container);
    repository = new AuthRepository(dataSource);
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE "auth"."outbox", "auth"."sessions", "auth"."user_profiles", "auth"."users", "auth"."oauth_transactions" CASCADE');
  });

  afterAll(async () => {
    try {
      await dataSource?.destroy();
    } finally {
      await stopTestDatabase(db);
    }
  });

  it('atomically reserves and consumes an OAuth transaction only once', async () => {
    const stateHash = hashOAuthValue('state-atomic');
    await dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 0,
      consumedAt: null,
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      failedAt: null,
      maxAttempts: 5,
      nonceHash: hashOAuthValue('nonce-atomic'),
      pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
      processingAt: null,
      stateHash,
    });

    const reservations = await Promise.all([
      repository.beginOAuthExchange(stateHash, 'test'),
      repository.beginOAuthExchange(stateHash, 'test'),
    ]);
    const winner = reservations.filter((value): value is NonNullable<typeof value> => value !== null);
    expect(winner).toHaveLength(1);
    expect(winner[0].attemptCount).toBe(1);

    await repository.markOAuthTransactionConsumed(winner[0].id, winner[0].attemptCount);
    const row = await db.client.query<{ attempt_count: number; consumed_at: Date | null; processing_at: Date | null }>(
      'SELECT "attempt_count", "consumed_at", "processing_at" FROM "auth"."oauth_transactions" WHERE "id" = $1',
      [winner[0].id],
    );
    expect(row.rows[0]).toMatchObject({ attempt_count: 1, processing_at: null });
    expect(row.rows[0].consumed_at).toBeInstanceOf(Date);
    await expect(repository.beginOAuthExchange(stateHash, 'test')).resolves.toBeNull();
  });

  it('marks an OAuth transaction failed when its atomic attempt budget is exhausted', async () => {
    const stateHash = hashOAuthValue('state-exhausted');
    await dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 3,
      consumedAt: null,
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      failedAt: null,
      maxAttempts: 3,
      nonceHash: hashOAuthValue('nonce-exhausted'),
      pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
      processingAt: null,
      stateHash,
    });

    await expect(repository.beginOAuthExchange(stateHash, 'test')).resolves.toBeNull();
    const row = await db.client.query<{ failed_at: Date | null }>(
      'SELECT "failed_at" FROM "auth"."oauth_transactions" WHERE "state_hash" = $1',
      [stateHash],
    );
    expect(row.rows[0].failed_at).toBeInstanceOf(Date);
  });

  it('does not reserve a transaction for another environment or after expiry', async () => {
    const environmentState = hashOAuthValue('state-environment');
    const expiredState = hashOAuthValue('state-expired');
    await dataSource.getRepository(OAuthTransaction).insert([
      {
        attemptCount: 0,
        consumedAt: null,
        environment: 'shared-dev',
        expiresAt: new Date(Date.now() + 60_000),
        failedAt: null,
        maxAttempts: 5,
        nonceHash: hashOAuthValue('nonce-environment'),
        pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
        processingAt: null,
        stateHash: environmentState,
      },
      {
        attemptCount: 0,
        consumedAt: null,
        environment: 'test',
        expiresAt: new Date(Date.now() - 60_000),
        failedAt: null,
        maxAttempts: 5,
        nonceHash: hashOAuthValue('nonce-expired'),
        pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
        processingAt: null,
        stateHash: expiredState,
      },
    ]);

    await expect(repository.beginOAuthExchange(environmentState, 'production')).resolves.toBeNull();
    await expect(repository.beginOAuthExchange(expiredState, 'test')).resolves.toBeNull();
    const rows = await db.client.query<{ readonly attempt_count: number; readonly processing_at: Date | null }>(
      'SELECT "attempt_count", "processing_at" FROM "auth"."oauth_transactions" ORDER BY "state_hash"',
    );
    expect(rows.rows).toEqual([
      { attempt_count: 0, processing_at: null },
      { attempt_count: 0, processing_at: null },
    ]);
    await expect(repository.beginOAuthExchange(environmentState, 'shared-dev')).resolves.toMatchObject({ attemptCount: 1 });
  });

  it('enforces the configured three-attempt lower bound with atomic release and failure', async () => {
    const stateHash = hashOAuthValue('state-retry-bound');
    await dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 0,
      consumedAt: null,
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      failedAt: null,
      maxAttempts: 3,
      nonceHash: hashOAuthValue('nonce-retry-bound'),
      pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
      processingAt: null,
      stateHash,
    });

    for (const attempt of [1, 2, 3]) {
      const reserved = await repository.beginOAuthExchange(stateHash, 'test');
      expect(reserved?.attemptCount).toBe(attempt);
      await repository.releaseOAuthTransaction(reserved!.id, reserved!.attemptCount);
    }
    await expect(repository.beginOAuthExchange(stateHash, 'test')).resolves.toBeNull();
    const row = await db.client.query<{ readonly attempt_count: number; readonly failed_at: Date | null }>(
      'SELECT "attempt_count", "failed_at" FROM "auth"."oauth_transactions" WHERE "state_hash" = $1',
      [stateHash],
    );
    expect(row.rows[0]).toMatchObject({ attempt_count: 3 });
    expect(row.rows[0].failed_at).toBeInstanceOf(Date);
  });

  it('consumes a reserved transaction once when consume requests race', async () => {
    const stateHash = hashOAuthValue('state-consume-race');
    await dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 0,
      consumedAt: null,
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      failedAt: null,
      maxAttempts: 5,
      nonceHash: hashOAuthValue('nonce-consume-race'),
      pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
      processingAt: null,
      stateHash,
    });
    const reserved = await repository.beginOAuthExchange(stateHash, 'test');
    expect(reserved).not.toBeNull();

    const consumeResults = await Promise.all([
      repository.markOAuthTransactionConsumed(reserved!.id, reserved!.attemptCount),
      repository.markOAuthTransactionConsumed(reserved!.id, reserved!.attemptCount),
    ]);
    expect(consumeResults.sort()).toEqual([0, 1]);
    const row = await db.client.query<{ readonly consumed_at: Date | null; readonly processing_at: Date | null }>(
      'SELECT "consumed_at", "processing_at" FROM "auth"."oauth_transactions" WHERE "id" = $1',
      [reserved!.id],
    );
    expect(row.rows[0].consumed_at).toBeInstanceOf(Date);
    expect(row.rows[0].processing_at).toBeNull();
  });

  it('reclaims a stale lease and fences the crashed attempt from clearing the new lease', async () => {
    const stateHash = hashOAuthValue('state-stale-lease');
    await dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 0,
      consumedAt: null,
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      failedAt: null,
      maxAttempts: 5,
      nonceHash: hashOAuthValue('nonce-stale-lease'),
      pkceVerifierCiphertext: Buffer.from('fixture-ciphertext'),
      processingAt: null,
      stateHash,
    });

    const first = await repository.beginOAuthExchange(stateHash, 'test');
    expect(first?.attemptCount).toBe(1);
    await db.client.query(
      'UPDATE "auth"."oauth_transactions" SET "processing_at" = now() - interval \'61 seconds\' WHERE "id" = $1',
      [first!.id],
    );

    const second = await repository.beginOAuthExchange(stateHash, 'test');
    expect(second?.attemptCount).toBe(2);
    await expect(repository.markOAuthTransactionConsumed(first!.id, first!.attemptCount)).resolves.toBe(0);
    await expect(repository.releaseOAuthTransaction(first!.id, first!.attemptCount)).resolves.toBe(0);
    await expect(repository.markOAuthTransactionConsumed(second!.id, second!.attemptCount)).resolves.toBe(1);
  });

  it('rotates refresh sessions, detects reuse, and rejects the revoked family', async () => {
    const user = await repository.upsertUser({
      email: 'Learner@Example.com',
      emailVerified: true,
      googleSub: 'google-sub-session',
      name: 'Learner',
      nonce: 'nonce',
    });
    const initial = await repository.createSessionPair(user.id);
    const rotated = await repository.rotateRefreshSession(initial.refreshToken);
    expect(rotated).not.toBeNull();
    expect(rotated?.refreshToken).not.toBe(initial.refreshToken);
    await expect(repository.getUserByAccessToken(rotated!.accessToken)).resolves.toMatchObject({
      email: 'learner@example.com',
      status: AccountStatus.ACTIVE,
    });

    await expect(repository.rotateRefreshSession(initial.refreshToken)).resolves.toBeNull();
    await expect(repository.getUserByAccessToken(rotated!.accessToken)).resolves.toBeNull();
    const revoked = await db.client.query<{ revoked_reason: string | null; count: string }>(
      'SELECT "revoked_reason", count(*) OVER ()::text AS count FROM "auth"."sessions" WHERE "session_family_id" = $1 AND "revoked_at" IS NOT NULL',
      [await familyIdFor(rotated!.refreshToken)],
    );
    expect(revoked.rows.length).toBeGreaterThan(0);
    expect(revoked.rows[0].count).toBe('4');
    expect(new Set(revoked.rows.map((row) => row.revoked_reason))).toEqual(new Set(['REUSE_DETECTED', 'ROTATED']));

    await repository.revokeSessionFamily(initial.accessToken, 'LOGOUT');
  });

  it('invalidates active sessions after account deletion without deleting the identity row', async () => {
    const user = await repository.upsertUser({
      email: 'deleted@example.com',
      emailVerified: true,
      googleSub: 'google-sub-deleted',
      nonce: 'nonce',
    });
    const session = await repository.createSessionPair(user.id);

    await repository.updateAccountStatus(user.id, AccountStatus.DELETED, 'ACCOUNT_DELETED');
    await expect(repository.getUserByAccessToken(session.accessToken)).resolves.toBeNull();
    const row = await db.client.query<{ status: string; deleted_at: Date | null }>(
      'SELECT "status", "deleted_at" FROM "auth"."users" WHERE "id" = $1',
      [user.id],
    );
    expect(row.rows[0]).toMatchObject({ status: AccountStatus.DELETED });
    expect(row.rows[0].deleted_at).toBeInstanceOf(Date);
  });

  it('writes one idempotent access-revocation command for a status transition', async () => {
    const user = await repository.upsertUser({
      email: 'suspended@example.com',
      emailVerified: true,
      googleSub: 'google-sub-suspended',
      nonce: 'nonce',
    });

    await repository.updateAccountStatus(user.id, AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');
    await repository.updateAccountStatus(user.id, AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');
    const rows = await db.client.query<{ readonly event_type: string; readonly payload: Record<string, unknown> }>(
      'SELECT "event_type", "payload" FROM "auth"."outbox" WHERE "aggregate_id" = $1',
      [user.id],
    );
    expect(rows.rows).toEqual([{
      event_type: 'AccountAccessRevoked',
      payload: { reason: 'ACCOUNT_SUSPENDED', userId: user.id },
    }]);
  });

  async function familyIdFor(refreshToken: string): Promise<string> {
    const row = await db.client.query<{ session_family_id: string }>(
      'SELECT "session_family_id" FROM "auth"."sessions" WHERE "token_hash" = $1',
      [hashOAuthValue(refreshToken)],
    );
    return row.rows[0].session_family_id;
  }
});
