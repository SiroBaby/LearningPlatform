import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('durable processing queue migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('keeps lease, retry, and DLQ state', async () => {
    expect(await columnNames()).toEqual(expect.arrayContaining([
      'completed_at',
      'cancellation_marker_id',
      'cancellation_reason',
      'cancelled_at',
      'failure_code',
      'lease_id',
      'lease_until',
      'next_visible_at',
      'technical_retry_count',
    ]));
    expect(await tableName('ai.processing_job_dlq')).toBe('ai.processing_job_dlq');
    expect(await tableName('ai.account_access_revocations')).toBe('ai.account_access_revocations');
  });

  it('keeps cancellation markers idempotent and separate from auth identity', async () => {
    const indexes = await db.client.query<{ readonly indexName: string }>(
      `SELECT indexname AS "indexName"
       FROM pg_indexes
       WHERE schemaname = 'ai' AND tablename = 'account_access_revocations'`,
    );
    expect(indexes.rows.map((row) => row.indexName)).toEqual(expect.arrayContaining([
      'uq_ai_account_access_revocations_event_key',
      'idx_ai_account_access_revocations_user_time',
    ]));

    const foreignKeys = await db.client.query<{ readonly constraintName: string }>(
      `SELECT constraint_name AS "constraintName"
       FROM information_schema.table_constraints
       WHERE table_schema = 'ai'
         AND table_name = 'account_access_revocations'
         AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(foreignKeys.rows).toHaveLength(0);

    const statusConstraint = await db.client.query<{ readonly definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'chk_ai_processing_jobs_status'`,
    );
    expect(statusConstraint.rows[0]?.definition).toContain('CANCELLED');
  });
  async function columnNames(): Promise<string[]> {
    const result = await db.client.query<{ readonly column_name: string }>(
      `SELECT "column_name" FROM "information_schema"."columns"
       WHERE "table_schema" = 'ai' AND "table_name" = 'processing_jobs'`,
    );
    return result.rows.map((row) => row.column_name);
  }

  async function tableName(qualifiedName: string): Promise<string | null> {
    const result = await db.client.query<{ readonly tableName: string | null }>(
      'SELECT to_regclass($1) AS "tableName"',
      [qualifiedName],
    );
    return result.rows[0]?.tableName ?? null;
  }
});
