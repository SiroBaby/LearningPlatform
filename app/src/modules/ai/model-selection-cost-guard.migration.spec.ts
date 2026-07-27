import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('model selection and cost guard migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('creates isolated schema tables and reverses the target migration', async () => {
    expect(await tableName('ai.owner_model_configs')).toBe('ai.owner_model_configs');
    expect(await tableName('course.owner_entitlements')).toBe('course.owner_entitlements');
    expect(await tableName('course.owner_credit_wallets')).toBe('course.owner_credit_wallets');
    expect(await tableName('course.credit_ledger_entries')).toBe('course.credit_ledger_entries');
    expect(await tableName('ai.owner_entitlements')).toBeNull();
    expect(await tableName('ai.owner_credit_wallets')).toBeNull();
    expect(await tableName('ai.credit_ledger_entries')).toBeNull();
    expect(await tableName('ai.provider_usage_records')).toBe('ai.provider_usage_records');
    expect(await documentColumnName('estimate_status')).toBe('estimate_status');
    expect(await documentColumnName('estimated_credits')).toBe('estimated_credits');
    expect(await documentColumnName('settled_credits')).toBe('settled_credits');
    expect(await documentColumnName('budget_status')).toBe('budget_status');

    await revertThroughMigration('1780835014400');

    expect(await tableName('course.owner_entitlements')).toBeNull();
    expect(await tableName('course.owner_credit_wallets')).toBeNull();
    expect(await tableName('course.credit_ledger_entries')).toBeNull();
    expect(await tableName('ai.owner_entitlements')).toBe('ai.owner_entitlements');
    expect(await tableName('ai.owner_credit_wallets')).toBe('ai.owner_credit_wallets');
    expect(await tableName('ai.credit_ledger_entries')).toBe('ai.credit_ledger_entries');
    expect(await tableName('course.documents')).toBe('course.documents');
    expect(await documentColumnName('estimate_status')).toBeNull();

    await runUp(db.client);
  });

  async function revertThroughMigration(version: string): Promise<void> {
    while (true) {
      const latest = await db.client.query<{ readonly version: string }>(
        'SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1',
      );
      const current = latest.rows[0]?.version;
      if (!current || current < version) return;
      await runDown(db.client);
    }
  }

  async function tableName(qualifiedName: string): Promise<string | null> {
    const result = await db.client.query<{ readonly tableName: string | null }>(
      'SELECT to_regclass($1) AS "tableName"',
      [qualifiedName],
    );
    return result.rows[0]?.tableName ?? null;
  }

  async function documentColumnName(columnName: string): Promise<string | null> {
    const result = await db.client.query<{ readonly columnName: string | null }>(
      `SELECT "column_name" AS "columnName"
       FROM "information_schema"."columns"
       WHERE "table_schema" = 'course' AND "table_name" = 'documents' AND "column_name" = $1`,
      [columnName],
    );
    return result.rows[0]?.columnName ?? null;
  }
});
