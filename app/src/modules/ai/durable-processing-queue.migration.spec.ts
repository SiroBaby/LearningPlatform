import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
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

  it('grants Go worker only a read-only source descriptor and reverses its migration', async () => {
    const documentId = randomUUID();
    const ownerId = randomUUID();
    await db.client.query(
      `INSERT INTO "course"."documents" ("id", "owner_id", "type", "original_name", "storage_ref", "size_bytes", "status")
       VALUES ($1, $2, 'TEXT', 'source.txt', 'owners/source.txt', 4, 'PROCESSING')`,
      [documentId, ownerId],
    );

    await db.client.query('SET ROLE ai_worker');
    try {
      const descriptor = await db.client.query(
        `SELECT "id", "owner_id", "type", "storage_ref", "size_bytes", "status"
         FROM "course"."documents" WHERE "id" = $1 AND "owner_id" = $2`,
        [documentId, ownerId],
      );
      expect(descriptor.rows).toHaveLength(1);
      await expect(db.client.query(
        `UPDATE "course"."documents" SET "status" = 'READY' WHERE "id" = $1`,
        [documentId],
      )).rejects.toMatchObject({ code: '42501' });
      await expect(db.client.query(
        `SELECT "original_name" FROM "course"."documents" WHERE "id" = $1`,
        [documentId],
      )).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.client.query('RESET ROLE');
    }

    await runDown(db.client);
    const role = await db.client.query<{ readonly exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_worker') AS "exists"`,
    );
    expect(role.rows[0]?.exists).toBe(false);
    await runUp(db.client);
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
