import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('auth identity migration', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
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

    await expect(db.client.query(
      `INSERT INTO "auth"."user_profiles" ("user_id", "onboarding_completed_at", "onboarding_skipped_at") VALUES ($1, now(), now())`,
      [userId],
    )).rejects.toThrow();

    await db.client.query(`DELETE FROM "auth"."users" WHERE "id" = $1`, [userId]);
    expect((await db.client.query(`SELECT to_regclass('auth.user_profiles') AS table_name`)).rows[0].table_name).toBe('auth.user_profiles');
  });
});
