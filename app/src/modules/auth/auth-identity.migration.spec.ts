import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { startTestDatabase, stopTestDatabase, type TestDb } from '../../test-support/test-db';

describe('auth identity migration', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  it('creates the auth tables and security constraints', async () => {
    const tables = await db.client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'auth'
      ORDER BY table_name
    `);

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'oauth_transactions',
      'outbox',
      'sessions',
      'super_admin_audit_events',
      'super_admin_external_approval_consumptions',
      'super_admin_role_change_approvals',
      'super_admin_role_change_requests',
      'user_profiles',
      'users',
    ]);

    const constraints = await db.client.query<{ constraint_name: string }>(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE constraint_schema = 'auth'
    `);
    const names = constraints.rows.map((row) => row.constraint_name);
    expect(names).toEqual(expect.arrayContaining([
      'chk_auth_users_role',
      'chk_auth_users_status',
      'chk_auth_user_profiles_onboarding_state',
      'chk_auth_oauth_transactions_attempts',
    ]));
  });

  it('enforces identity uniqueness and profile lifecycle constraints', async () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email") VALUES ($1, $2, $3)`,
      [userId, 'google-sub-1', 'owner@example.com'],
    );

    await expect(db.client.query(
      `INSERT INTO "auth"."users" ("google_sub", "normalized_email") VALUES ($1, $2)`,
      ['google-sub-1', 'other@example.com'],
    )).rejects.toThrow();

    const oauthTransaction = {
      environment: 'test',
      expiresAt: new Date(Date.now() + 60_000),
      nonceHash: 'nonce-hash-1',
      pkceVerifierCiphertext: Buffer.from('encrypted-verifier'),
      stateHash: 'state-hash-1',
    };
    await db.client.query(
      `INSERT INTO "auth"."oauth_transactions"
        ("environment", "expires_at", "nonce_hash", "pkce_verifier_ciphertext", "state_hash")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        oauthTransaction.environment,
        oauthTransaction.expiresAt,
        oauthTransaction.nonceHash,
        oauthTransaction.pkceVerifierCiphertext,
        oauthTransaction.stateHash,
      ],
    );
    await expect(db.client.query(
      `INSERT INTO "auth"."oauth_transactions"
        ("environment", "expires_at", "nonce_hash", "pkce_verifier_ciphertext", "state_hash")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        oauthTransaction.environment,
        oauthTransaction.expiresAt,
        'nonce-hash-2',
        oauthTransaction.pkceVerifierCiphertext,
        oauthTransaction.stateHash,
      ],
    )).rejects.toThrow();
    for (const maxAttempts of [2, 6]) {
      await expect(db.client.query(
        `INSERT INTO "auth"."oauth_transactions"
          ("environment", "expires_at", "max_attempts", "nonce_hash", "pkce_verifier_ciphertext", "state_hash")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          oauthTransaction.environment,
          oauthTransaction.expiresAt,
          maxAttempts,
          `nonce-hash-${maxAttempts}`,
          oauthTransaction.pkceVerifierCiphertext,
          `state-hash-${maxAttempts}`,
        ],
      )).rejects.toThrow();
    }

    await expect(db.client.query(
      `INSERT INTO "auth"."user_profiles" ("user_id", "onboarding_completed_at", "onboarding_skipped_at") VALUES ($1, now(), now())`,
      [userId],
    )).rejects.toThrow();

    await db.client.query(
      `INSERT INTO "auth"."user_profiles" ("user_id", "display_name") VALUES ($1, $2)`,
      [userId, 'Learner'],
    );
    await db.client.query(`DELETE FROM "auth"."users" WHERE "id" = $1`, [userId]);
    expect((await db.client.query(`SELECT to_regclass('auth.user_profiles') AS table_name`)).rows[0].table_name).toBe('auth.user_profiles');
    expect((await db.client.query(`SELECT count(*)::int AS count FROM "auth"."user_profiles" WHERE "user_id" = $1`, [userId])).rows[0].count).toBe(0);
  });

  it('keeps SUPER_ADMIN audit events immutable', async () => {
    const userId = '00000000-0000-0000-0000-000000000003';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email") VALUES ($1, $2, $3)`,
      [userId, 'google-sub-audit', 'audit@example.com'],
    );
    const event = await db.client.query<{ id: string }>(
      `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id")
       VALUES ('BOOTSTRAP_COMPLETED', $1) RETURNING "id"`, [userId],
    );

    await expect(db.client.query(
      `UPDATE "auth"."super_admin_audit_events" SET "event_type" = 'TAMPERED' WHERE "id" = $1`,
      [event.rows[0].id],
    )).rejects.toThrow('SUPER_ADMIN audit events are immutable');
    await expect(db.client.query(
      `DELETE FROM "auth"."super_admin_audit_events" WHERE "id" = $1`,
      [event.rows[0].id],
    )).rejects.toThrow('SUPER_ADMIN audit events are immutable');
  });

  it('fails closed instead of dropping role-change or audit history during rollback', async () => {
    const requesterId = '00000000-0000-0000-0000-000000000004';
    const targetId = '00000000-0000-0000-0000-000000000005';
    const approverId = '00000000-0000-0000-0000-000000000003';
    await db.client.query(
      `INSERT INTO "auth"."users" ("id", "google_sub", "normalized_email") VALUES
        ($1, 'google-sub-history-requester', 'history-requester@example.com'),
        ($2, 'google-sub-history-target', 'history-target@example.com')`,
      [requesterId, targetId],
    );
    const request = await db.client.query<{ id: string }>(
      `INSERT INTO "auth"."super_admin_role_change_requests" ("requester_id", "target_user_id", "desired_role")
       VALUES ($1, $2, 'SUPER_ADMIN') RETURNING "id"`,
      [requesterId, targetId],
    );
    await db.client.query(
      `INSERT INTO "auth"."super_admin_role_change_approvals" ("request_id", "approver_id") VALUES ($1, $2)`,
      [request.rows[0].id, approverId],
    );

    const downSql = readFileSync(join(__dirname, '../../database/migrations/1787803960000_add_super_admin_rbac.down.sql'), 'utf8');
    await expect(db.client.query(downSql)).rejects.toThrow('Cannot revert SUPER_ADMIN RBAC while role-change or audit history exists');

    const history = await db.client.query<{ table_name: string; row_count: string }>(`
      SELECT table_name, row_count
      FROM (
        SELECT 'super_admin_role_change_requests' AS table_name, count(*)::text AS row_count
        FROM "auth"."super_admin_role_change_requests"
        WHERE "id" = $1
        UNION ALL
        SELECT 'super_admin_role_change_approvals', count(*)::text
        FROM "auth"."super_admin_role_change_approvals"
        WHERE "request_id" = $1 AND "approver_id" = $2
        UNION ALL
        SELECT 'super_admin_audit_events', count(*)::text
        FROM "auth"."super_admin_audit_events"
      ) AS history`,
      [request.rows[0].id, approverId],
    );
    expect(history.rows).toEqual([
      { table_name: 'super_admin_role_change_requests', row_count: '1' },
      { table_name: 'super_admin_role_change_approvals', row_count: '1' },
      { table_name: 'super_admin_audit_events', row_count: '1' },
    ]);
  });

  it('fails closed instead of dropping SUPER_ADMIN data during rollback', async () => {
    await db.client.query(
      `INSERT INTO "auth"."users" ("google_sub", "normalized_email", "role") VALUES ($1, $2, 'SUPER_ADMIN')`,
      ['google-sub-super-admin-down', 'super-admin-down@example.com'],
    );
    const downSql = readFileSync(join(__dirname, '../../database/migrations/1787803960000_add_super_admin_rbac.down.sql'), 'utf8');

    await expect(db.client.query(downSql)).rejects.toThrow('Cannot revert SUPER_ADMIN RBAC while SUPER_ADMIN accounts exist');
    expect((await db.client.query(`SELECT to_regclass('auth.super_admin_role_change_requests') AS table_name`)).rows[0].table_name)
      .toBe('auth.super_admin_role_change_requests');
  });
});
