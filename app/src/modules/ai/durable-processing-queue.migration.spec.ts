import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('durable processing queue migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('keeps lease, retry, and DLQ state', async () => {
    expect(await columnNames()).toEqual(expect.arrayContaining([
      'completed_at',
      'failure_code',
      'lease_id',
      'lease_until',
      'next_visible_at',
      'technical_retry_count',
    ]));
    expect(await tableName('ai.processing_job_dlq')).toBe('ai.processing_job_dlq');
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
