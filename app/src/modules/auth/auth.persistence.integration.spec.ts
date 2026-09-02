import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { startTestDatabase, stopTestDatabase, type TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { OAuthTransaction } from './entities/oauth-transaction.entity';
import { Session } from './entities/session.entity';
import { AccountStatus } from './enums/account-status.enum';
import { AuthRepository } from './repositories/auth.repository';
import { hashOAuthValue } from './oauth-crypto';
import type { ExternalApprovalConsumption } from './repositories/auth.repository';

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

  it('serializes concurrent first SUPER_ADMIN bootstraps and revokes the winning session family', async () => {
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'ADMIN')`,
      [
        '00000000-0000-0000-0000-000000000101', 'bootstrap-admin-1', 'bootstrap-admin-1@example.com',
        '00000000-0000-0000-0000-000000000102', 'bootstrap-admin-2', 'bootstrap-admin-2@example.com',
      ],
    );
    const firstSession = await repository.createSessionPair('00000000-0000-0000-0000-000000000101');
    const secondSession = await repository.createSessionPair('00000000-0000-0000-0000-000000000102');

    const results = await Promise.all([
      repository.bootstrapFirstSuperAdmin('00000000-0000-0000-0000-000000000101'),
      repository.bootstrapFirstSuperAdmin('00000000-0000-0000-0000-000000000102'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.client.query(`SELECT count(*)::int AS "count" FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN'`)).rows[0].count).toBe(1);
    const winningToken = results[0] ? firstSession.accessToken : secondSession.accessToken;
    const losingToken = results[0] ? secondSession.accessToken : firstSession.accessToken;
    await expect(repository.getUserByAccessToken(winningToken)).resolves.toBeNull();
    await expect(repository.getUserByAccessToken(losingToken)).resolves.toMatchObject({ status: AccountStatus.ACTIVE });
  });

  it('bootstraps an active ADMIN when only an inactive SUPER_ADMIN remains', async () => {
    const inactiveSuperAdminId = '00000000-0000-0000-0000-000000000103';
    const adminId = '00000000-0000-0000-0000-000000000104';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role", "status") VALUES
       ($1, $2, $3, 'SUPER_ADMIN', 'SUSPENDED'), ($4, $5, $6, 'ADMIN', 'ACTIVE')`,
      [inactiveSuperAdminId, 'inactive-bootstrap-super-admin', 'inactive-bootstrap-super-admin@example.com', adminId, 'active-bootstrap-admin', 'active-bootstrap-admin@example.com'],
    );

    await expect(repository.bootstrapFirstSuperAdmin(adminId)).resolves.toBe(true);
    const roles = await db.client.query<{ role: string; status: string }>(
      `SELECT "role", "status" FROM "auth"."users" WHERE "id" IN ($1, $2) ORDER BY "id"`,
      [inactiveSuperAdminId, adminId],
    );
    expect(roles.rows).toEqual([
      { role: 'SUPER_ADMIN', status: 'SUSPENDED' },
      { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    ]);
  });

  it('does not restart first bootstrap after a historical bootstrap and exposes recovery modes', async () => {
    const firstId = '00000000-0000-0000-0000-000000000171';
    const secondId = '00000000-0000-0000-0000-000000000172';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'ADMIN')`,
      [firstId, 'historical-bootstrap-first', 'historical-bootstrap-first@example.com', secondId, 'historical-bootstrap-second', 'historical-bootstrap-second@example.com'],
    );

    await expect(repository.bootstrapFirstSuperAdmin(firstId)).resolves.toBe(true);
    await db.client.query(`UPDATE "auth"."users" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [firstId]);
    await expect(repository.bootstrapFirstSuperAdmin(secondId)).resolves.toBe(false);
    await expect(repository.getSuperAdminBootstrapStatus()).resolves.toMatchObject({
      activeSuperAdminCount: 0,
      mode: 'LOCKOUT_RECOVERY',
    });
  });

  it('lets an ADMIN requester complete promotion with two distinct SUPER_ADMIN approvals', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000105';
    const firstApproverId = '00000000-0000-0000-0000-000000000106';
    const secondApproverId = '00000000-0000-0000-0000-000000000107';
    const targetId = '00000000-0000-0000-0000-000000000108';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN'), ($10, $11, $12, 'USER')`,
      [requesterId, 'admin-requester', 'admin-requester@example.com', firstApproverId, 'approval-one', 'approval-one@example.com', secondApproverId, 'approval-two', 'approval-two@example.com', targetId, 'approval-target', 'approval-target@example.com'],
    );

    const requestId = await repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'SUPER_ADMIN',
      requesterId,
      targetUserId: targetId,
    });
    expect(requestId).not.toBe('');
    expect(await repository.approveSuperAdminRoleChange({ approverId: firstApproverId, requestId })).toBe(1);
    expect(await repository.approveSuperAdminRoleChange({ approverId: secondApproverId, requestId })).toBe(2);
    expect((await db.client.query<{ role: string }>(`SELECT "role" FROM "auth"."users" WHERE "id" = $1`, [targetId])).rows[0].role)
      .toBe('SUPER_ADMIN');
  });

  it('rejects an ADMIN requester when fewer than two eligible approvers remain and does not persist a request', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000141';
    const approverId = '00000000-0000-0000-0000-000000000142';
    const targetId = '00000000-0000-0000-0000-000000000143';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'USER')`,
      [requesterId, 'admin-requester-insufficient', 'admin-requester-insufficient@example.com', approverId, 'only-approver', 'only-approver@example.com', targetId, 'insufficient-target', 'insufficient-target@example.com'],
    );

    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'SUPER_ADMIN',
      requesterId,
      targetUserId: targetId,
    })).resolves.toBe('');
    expect((await db.client.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "auth"."super_admin_role_change_requests" WHERE "requester_id" = $1`,
      [requesterId],
    )).rows[0].count).toBe(0);
  });

  it('keeps a two-SUPER_ADMIN quorum from creating a request targeting either approver', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000144';
    const firstSuperAdminId = '00000000-0000-0000-0000-000000000145';
    const secondSuperAdminId = '00000000-0000-0000-0000-000000000146';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN')`,
      [
        requesterId, 'two-quorum-requester', 'two-quorum-requester@example.com',
        firstSuperAdminId, 'two-quorum-first', 'two-quorum-first@example.com',
        secondSuperAdminId, 'two-quorum-second', 'two-quorum-second@example.com',
      ],
    );

    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'ADMIN', requesterId, targetUserId: firstSuperAdminId,
    })).resolves.toBe('');
    expect((await db.client.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "auth"."super_admin_role_change_requests" WHERE "requester_id" = $1`,
      [requesterId],
    )).rows[0].count).toBe(0);
  });

  it('rejects no-op role changes before persisting a request', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000161';
    const firstApproverId = '00000000-0000-0000-0000-000000000162';
    const secondApproverId = '00000000-0000-0000-0000-000000000163';
    const thirdApproverId = '00000000-0000-0000-0000-000000000164';
    const userTargetId = '00000000-0000-0000-0000-000000000165';
    const superAdminTargetId = '00000000-0000-0000-0000-000000000166';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN'),
       ($10, $11, $12, 'SUPER_ADMIN'), ($13, $14, $15, 'USER'), ($16, $17, $18, 'SUPER_ADMIN')`,
      [
        requesterId, 'no-op-requester', 'no-op-requester@example.com',
        firstApproverId, 'no-op-approver-one', 'no-op-approver-one@example.com',
        secondApproverId, 'no-op-approver-two', 'no-op-approver-two@example.com',
        thirdApproverId, 'no-op-approver-three', 'no-op-approver-three@example.com',
        userTargetId, 'no-op-user-target', 'no-op-user-target@example.com',
        superAdminTargetId, 'no-op-super-admin-target', 'no-op-super-admin-target@example.com',
      ],
    );

    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'ADMIN', requesterId, targetUserId: userTargetId,
    })).resolves.toBe('');
    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'SUPER_ADMIN', requesterId, targetUserId: superAdminTargetId,
    })).resolves.toBe('');
    expect((await db.client.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "auth"."super_admin_role_change_requests" WHERE "requester_id" = $1`,
      [requesterId],
    )).rows[0].count).toBe(0);
  });

  it('revokes target sessions on a completed role change', async () => {
    const ids = ['00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000114'];
    const targetId = '00000000-0000-0000-0000-000000000115';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN'), ($10, $11, $12, 'ADMIN')`,
      [ids[0], 'approver-one', 'approver-one@example.com', ids[1], 'approver-two', 'approver-two@example.com', ids[2], 'approver-three', 'approver-three@example.com', targetId, 'target-admin', 'target-admin@example.com'],
    );
    const targetSession = await repository.createSessionPair(targetId);
    const requestId = await repository.createSuperAdminRoleChangeRequest({ desiredRole: 'SUPER_ADMIN', requesterId: ids[0], targetUserId: targetId });
    expect(requestId).not.toBe('');
    expect(await repository.approveSuperAdminRoleChange({ approverId: ids[0], requestId })).toBe(0);
    expect(await repository.approveSuperAdminRoleChange({ approverId: ids[1], requestId })).toBe(1);
    expect(await repository.approveSuperAdminRoleChange({ approverId: ids[2], requestId })).toBe(2);
    await expect(repository.getUserByAccessToken(targetSession.accessToken)).resolves.toBeNull();
  });

  it('requires two currently active SUPER_ADMIN approvals at completion time', async () => {
    const ids = ['00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-000000000124'];
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN'), ($10, $11, $12, 'ADMIN')`,
      [ids[0], 'requester-active', 'requester-active@example.com', ids[1], 'approver-historic', 'approver-historic@example.com', ids[2], 'approver-current', 'approver-current@example.com', ids[3], 'target-current', 'target-current@example.com'],
    );
    const requestId = await repository.createSuperAdminRoleChangeRequest({ desiredRole: 'SUPER_ADMIN', requesterId: ids[0], targetUserId: ids[3] });
    expect(await repository.approveSuperAdminRoleChange({ approverId: ids[1], requestId })).toBe(1);
    await db.client.query(`UPDATE "auth"."users" SET "status" = 'SUSPENDED' WHERE "id" = $1`, [ids[1]]);
    expect(await repository.approveSuperAdminRoleChange({ approverId: ids[2], requestId })).toBe(1);
    const target = await db.client.query<{ role: string }>(`SELECT "role" FROM "auth"."users" WHERE "id" = $1`, [ids[3]]);
    expect(target.rows[0].role).toBe('ADMIN');
  });

  it('revokes an existing session when break-glass elevates the target', async () => {
    const primaryId = '00000000-0000-0000-0000-000000000131';
    const targetId = '00000000-0000-0000-0000-000000000132';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'ADMIN')`,
      [primaryId, 'break-glass-primary', 'break-glass-primary@example.com', targetId, 'break-glass-target', 'break-glass-target@example.com'],
    );
    const session = await repository.createSessionPair(targetId);

    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: targetId, approval: approval(targetId) })).resolves.toBe(true);
    await expect(repository.getUserByAccessToken(session.accessToken)).resolves.toBeNull();
    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: targetId, approval: approval(targetId) })).resolves.toBe(false);
  });

  it('rejects an expired external approval without consuming its jti', async () => {
    const primaryId = '00000000-0000-0000-0000-000000000133';
    const targetId = '00000000-0000-0000-0000-000000000134';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'ADMIN')`,
      [primaryId, 'expired-approval-primary', 'expired-approval-primary@example.com', targetId, 'expired-approval-target', 'expired-approval-target@example.com'],
    );

    const expiredApproval: ExternalApprovalConsumption = {
      ...approval(targetId),
      expiresAt: new Date(Date.now() - 60_000),
      jtiHash: hashOAuthValue('expired-break-glass-jti'),
    };
    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: targetId, approval: expiredApproval })).resolves.toBe(false);
    expect((await db.client.query(`SELECT count(*)::int AS count FROM "auth"."super_admin_external_approval_consumptions"`)).rows[0].count).toBe(0);
  });

  it('does not approve a role-change request after its 30-minute expiry', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000135';
    const firstApproverId = '00000000-0000-0000-0000-000000000136';
    const secondApproverId = '00000000-0000-0000-0000-000000000137';
    const targetId = '00000000-0000-0000-0000-000000000138';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'SUPER_ADMIN'), ($7, $8, $9, 'SUPER_ADMIN'), ($10, $11, $12, 'USER')`,
      [requesterId, 'expired-requester', 'expired-requester@example.com', firstApproverId, 'expired-approver-one', 'expired-approver-one@example.com', secondApproverId, 'expired-approver-two', 'expired-approver-two@example.com', targetId, 'expired-target', 'expired-target@example.com'],
    );
    const requestId = await repository.createSuperAdminRoleChangeRequest({ desiredRole: 'SUPER_ADMIN', requesterId, targetUserId: targetId });
    await db.client.query(`UPDATE "auth"."super_admin_role_change_requests" SET "expires_at" = now() - interval '1 second' WHERE "id" = $1`, [requestId]);

    await expect(repository.approveSuperAdminRoleChange({ approverId: firstApproverId, requestId })).resolves.toBe(0);
    expect((await db.client.query(`SELECT count(*)::int AS count FROM "auth"."super_admin_role_change_approvals" WHERE "request_id" = $1`, [requestId])).rows[0].count).toBe(0);
  });

  it('completes the four-account bootstrap without letting the sole SUPER_ADMIN mint an approver', async () => {
    const firstId = '00000000-0000-0000-0000-000000000181';
    const secondId = '00000000-0000-0000-0000-000000000182';
    const temporaryId = '00000000-0000-0000-0000-000000000183';
    const requesterId = '00000000-0000-0000-0000-000000000184';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'ADMIN'), ($4, $5, $6, 'ADMIN'), ($7, $8, $9, 'ADMIN'), ($10, $11, $12, 'ADMIN')`,
      [
        firstId, 'cohort-first', 'cohort-first@example.com',
        secondId, 'cohort-second', 'cohort-second@example.com',
        temporaryId, 'cohort-temporary', 'cohort-temporary@example.com',
        requesterId, 'cohort-requester', 'cohort-requester@example.com',
      ],
    );

    await expect(repository.bootstrapFirstSuperAdmin(firstId)).resolves.toBe(true);
    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: temporaryId, approval: approval(temporaryId) })).resolves.toBe(true);
    const requestId = await repository.createSuperAdminRoleChangeRequest({ desiredRole: 'SUPER_ADMIN', requesterId, targetUserId: secondId });
    expect(requestId).not.toBe('');
    expect(await repository.approveSuperAdminRoleChange({ approverId: firstId, requestId })).toBe(1);
    expect(await repository.approveSuperAdminRoleChange({ approverId: temporaryId, requestId })).toBe(2);

    const roles = await db.client.query<{ readonly id: string; readonly role: string; readonly super_admin_expires_at: Date | null }>(
      `SELECT "id", "role", "super_admin_expires_at" FROM "auth"."users" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"`,
      [[firstId, secondId, temporaryId, requesterId]],
    );
    expect(roles.rows).toEqual([
      { id: firstId, role: 'SUPER_ADMIN', super_admin_expires_at: null },
      { id: secondId, role: 'SUPER_ADMIN', super_admin_expires_at: null },
      { id: temporaryId, role: 'SUPER_ADMIN', super_admin_expires_at: expect.any(Date) },
      { id: requesterId, role: 'ADMIN', super_admin_expires_at: null },
    ]);
  });

  it('invalidates a temporary approver epoch across expiry and re-elevation', async () => {
    const primaryId = '00000000-0000-0000-0000-000000000191';
    const temporaryId = '00000000-0000-0000-0000-000000000192';
    const requesterId = '00000000-0000-0000-0000-000000000193';
    const targetId = '00000000-0000-0000-0000-000000000194';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'ADMIN'), ($7, $8, $9, 'ADMIN'), ($10, $11, $12, 'USER')`,
      [
        primaryId, 'epoch-primary', 'epoch-primary@example.com',
        temporaryId, 'epoch-temporary', 'epoch-temporary@example.com',
        requesterId, 'epoch-requester', 'epoch-requester@example.com',
        targetId, 'epoch-target', 'epoch-target@example.com',
      ],
    );
    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: temporaryId, approval: approval(temporaryId) })).resolves.toBe(true);
    // Break-glass revokes sessions that existed before elevation; the temporary
    // approver must authenticate again before its expiry can be observed.
    const temporarySession = await repository.createSessionPair(temporaryId);
    const requestId = await repository.createSuperAdminRoleChangeRequest({ desiredRole: 'SUPER_ADMIN', requesterId, targetUserId: targetId });
    expect(await repository.approveSuperAdminRoleChange({ approverId: temporaryId, requestId })).toBe(1);

    await db.client.query(`UPDATE "auth"."users" SET "super_admin_expires_at" = now() - interval '1 second' WHERE "id" = $1`, [temporaryId]);
    await expect(repository.rotateRefreshSession(temporarySession.refreshToken)).resolves.toBeNull();
    await expect(repository.getUserByAccessToken(temporarySession.accessToken)).resolves.toBeNull();
    await repository.expireExpiredBreakGlassSuperAdmins();

    const afterExpiry = await db.client.query<{ readonly role: string; readonly super_admin_role_epoch: string }>(
      `SELECT "role", "super_admin_role_epoch" FROM "auth"."users" WHERE "id" = $1`, [temporaryId],
    );
    expect(afterExpiry.rows[0]).toMatchObject({ role: 'ADMIN' });
    const oldApproval = await db.client.query<{ readonly count: number }>(
      `SELECT count(*)::int AS count
       FROM "auth"."super_admin_role_change_approvals"
       WHERE "request_id" = $1 AND "approver_id" = $2`, [requestId, temporaryId],
    );
    expect(oldApproval.rows[0].count).toBe(0);

    await expect(repository.grantBreakGlassSecondSuperAdmin({
      targetUserId: temporaryId,
      approval: { ...approval(temporaryId), jtiHash: hashOAuthValue('epoch-regrant') },
    })).resolves.toBe(true);
    expect(await repository.approveSuperAdminRoleChange({ approverId: temporaryId, requestId })).toBe(1);
    expect((await repository.getSuperAdminBootstrapStatus()).mode).toBe('NORMAL');
  });

  it('does not grant break-glass to an existing SUPER_ADMIN target', async () => {
    const targetId = '00000000-0000-0000-0000-000000000151';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN')`,
      [targetId, 'break-glass-existing-super-admin', 'break-glass-existing-super-admin@example.com'],
    );

    await expect(repository.grantBreakGlassSecondSuperAdmin({ targetUserId: targetId, approval: approval(targetId) })).resolves.toBe(false);
    expect((await db.client.query<{ role: string; super_admin_expires_at: Date | null }>(
      `SELECT "role", "super_admin_expires_at" FROM "auth"."users" WHERE "id" = $1`,
      [targetId],
    )).rows[0]).toEqual({ role: 'SUPER_ADMIN', super_admin_expires_at: null });
  });

  it('serializes concurrent break-glass grants so only one ADMIN target is elevated', async () => {
    const primaryId = '00000000-0000-0000-0000-000000000152';
    const firstTargetId = '00000000-0000-0000-0000-000000000153';
    const secondTargetId = '00000000-0000-0000-0000-000000000154';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email", "role") VALUES
       ($1, $2, $3, 'SUPER_ADMIN'), ($4, $5, $6, 'ADMIN'), ($7, $8, $9, 'ADMIN')`,
      [
        primaryId, 'break-glass-race-primary', 'break-glass-race-primary@example.com',
        firstTargetId, 'break-glass-race-first', 'break-glass-race-first@example.com',
        secondTargetId, 'break-glass-race-second', 'break-glass-race-second@example.com',
      ],
    );

    const results = await Promise.all([
      repository.grantBreakGlassSecondSuperAdmin({ targetUserId: firstTargetId, approval: approval(firstTargetId) }),
      repository.grantBreakGlassSecondSuperAdmin({ targetUserId: secondTargetId, approval: approval(secondTargetId) }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.client.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'`,
    )).rows[0].count).toBe(2);
    expect((await db.client.query<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "auth"."users" WHERE "role" = 'ADMIN' AND "status" = 'ACTIVE'`,
    )).rows[0].count).toBe(1);
  });

  async function familyIdFor(refreshToken: string): Promise<string> {
    const row = await db.client.query<{ session_family_id: string }>(
      'SELECT "session_family_id" FROM "auth"."sessions" WHERE "token_hash" = $1',
      [hashOAuthValue(refreshToken)],
    );
    return row.rows[0].session_family_id;
  }

  function approval(targetUserId: string): ExternalApprovalConsumption {
    return {
      action: 'GRANT_BREAK_GLASS_SUPER_ADMIN',
      audience: 'test-audience',
      environment: 'test',
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      jtiHash: hashOAuthValue(`break-glass:${targetUserId}`),
    };
  }
});
