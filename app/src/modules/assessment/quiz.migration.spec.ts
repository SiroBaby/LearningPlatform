import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, TestDb } from '../../test-support/test-db';

describe('quiz generation migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('creates quiz-owned tables and supports down then up through the SQL runner', async () => {
    const tables = await db.client.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'quiz'
      ORDER BY table_name
    `);

    expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
      'options',
      'questions',
      'quizzes',
    ]));
    expect((await db.client.query(`SELECT to_regclass('ai.generation_cache') AS table_name`)).rows[0].table_name).toBe('ai.generation_cache');
    expect((await db.client.query(`SELECT to_regclass('ai.prompt_versions') AS table_name`)).rows[0].table_name).toBe('ai.prompt_versions');
    await expect(db.client.query(`
      INSERT INTO "quiz"."questions" ("id", "quiz_id", "owner_id", "chunk_id", "chunk_index", "ordinal", "stem", "explanation", "citation_ref")
      VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 0, -1, 'stem', 'explanation', '{}'::jsonb)
    `)).rejects.toThrow();

    await revertThroughMigration('1780835014000');
    expect((await db.client.query(`SELECT to_regclass('quiz.quizzes') AS table_name`)).rows[0].table_name).toBeNull();
    expect((await db.client.query(`SELECT to_regclass('ai.generation_cache') AS table_name`)).rows[0].table_name).toBeNull();
    expect((await db.client.query(`SELECT to_regclass('ai.prompt_versions') AS table_name`)).rows[0].table_name).toBeNull();
    await runUp(db.client);
    expect((await db.client.query(`SELECT to_regclass('quiz.quizzes') AS table_name`)).rows[0].table_name).toBe('quiz.quizzes');
    expect((await db.client.query(`SELECT to_regclass('ai.generation_cache') AS table_name`)).rows[0].table_name).toBe('ai.generation_cache');
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
