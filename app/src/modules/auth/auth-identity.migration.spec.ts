import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

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
});
