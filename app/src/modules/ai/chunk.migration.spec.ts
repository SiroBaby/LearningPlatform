import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, TestDb } from '../../test-support/test-db';

describe('ai.chunks migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('enforces chunk constraints and supports down then up on an isolated database', async () => {
    const indexes = await db.client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'ai' AND tablename = 'chunks'
      ORDER BY indexname
    `);
    expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(expect.arrayContaining([
      'idx_chunks_owner_document_order',
      'uq_chunks_document_owner_index',
    ]));
    await expect(db.client.query(`
      INSERT INTO "ai"."chunks" ("id", "document_id", "owner_id", "chunk_index", "text", "locator", "content_hash")
      VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), -1, 'text', '{}'::jsonb, repeat('a', 64))
    `)).rejects.toThrow();

    await revertThroughMigration('1780835013900');
    expect((await db.client.query(`SELECT to_regclass('ai.chunks') AS table_name`)).rows[0].table_name).toBeNull();
    await runUp(db.client);
    expect((await db.client.query(`SELECT to_regclass('ai.chunks') AS table_name`)).rows[0].table_name).toBe('ai.chunks');
  });

  async function revertThroughMigration(version: string): Promise<void> {
    while (true) {
      const latest = await db.client.query<{ version: string }>(
        `SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1`,
      );
      const current = latest.rows[0]?.version;
      if (!current || current < version) return;
      await runDown(db.client);
    }
  }
});
