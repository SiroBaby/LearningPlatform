import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('quiz attempt migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('creates attempt tables and reverts without removing quiz generation tables', async () => {
    expect(await tableName('quiz.attempts')).toBe('quiz.attempts');
    expect(await tableName('quiz.attempt_answers')).toBe('quiz.attempt_answers');

    await revertThroughMigration('1780835014100');

    expect(await tableName('quiz.attempts')).toBeNull();
    expect(await tableName('quiz.attempt_answers')).toBeNull();
    expect(await tableName('quiz.quizzes')).toBe('quiz.quizzes');
    expect(await tableName('quiz.questions')).toBe('quiz.questions');
    expect(await tableName('quiz.options')).toBe('quiz.options');

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

  it('enforces attempt score and answer uniqueness constraints', async () => {
    const fixture = await insertQuizFixture();

    await expect(db.client.query(`
      INSERT INTO "quiz"."attempts" ("id", "quiz_id", "owner_id", "score", "question_count")
      VALUES ($1, $2, $3, -1, 1)
    `, [randomUUID(), fixture.quizId, fixture.ownerId])).rejects.toThrow();
    await expect(db.client.query(`
      INSERT INTO "quiz"."attempts" ("id", "quiz_id", "owner_id", "score", "question_count")
      VALUES ($1, $2, $3, 1, 0)
    `, [randomUUID(), fixture.quizId, fixture.ownerId])).rejects.toThrow();

    const attemptId = randomUUID();
    await db.client.query(`
      INSERT INTO "quiz"."attempts" ("id", "quiz_id", "owner_id", "score", "question_count")
      VALUES ($1, $2, $3, 1, 1)
    `, [attemptId, fixture.quizId, fixture.ownerId]);
    await db.client.query(`
      INSERT INTO "quiz"."attempt_answers"
        ("attempt_id", "question_id", "selected_option_id", "owner_id", "is_correct")
      VALUES ($1, $2, $3, $4, true)
    `, [attemptId, fixture.questionId, fixture.optionId, fixture.ownerId]);
    await expect(db.client.query(`
      INSERT INTO "quiz"."attempt_answers"
        ("attempt_id", "question_id", "selected_option_id", "owner_id", "is_correct")
      VALUES ($1, $2, $3, $4, false)
    `, [attemptId, fixture.questionId, fixture.optionId, fixture.ownerId])).rejects.toThrow();
  });

  it('keeps every attempt foreign key inside the quiz schema', async () => {
    const foreignKeySchemas = await db.client.query<{ referenced_schema: string }>(`
      SELECT referenced_namespace.nspname AS referenced_schema
      FROM pg_constraint constraint_record
      JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class referenced_table ON referenced_table.oid = constraint_record.confrelid
      JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
      WHERE constraint_record.contype = 'f'
        AND source_namespace.nspname = 'quiz'
        AND source_table.relname IN ('attempts', 'attempt_answers')
    `);

    expect(foreignKeySchemas.rows).toHaveLength(4);
    expect(foreignKeySchemas.rows.every((row) => row.referenced_schema === 'quiz')).toBe(true);
  });

  async function tableName(qualifiedName: string): Promise<string | null> {
    const result = await db.client.query<{ table_name: string | null }>(
      'SELECT to_regclass($1) AS table_name',
      [qualifiedName],
    );
    return result.rows[0]?.table_name ?? null;
  }

  async function insertQuizFixture(): Promise<{
    readonly optionId: string;
    readonly ownerId: string;
    readonly questionId: string;
    readonly quizId: string;
  }> {
    const ownerId = randomUUID();
    const quizId = randomUUID();
    const questionId = randomUUID();
    const optionId = randomUUID();
    const chunkId = randomUUID();

    await db.client.query(`
      INSERT INTO "quiz"."quizzes"
        ("id", "document_id", "owner_id", "prompt_version", "idempotency_key")
      VALUES ($1, $2, $3, 'prompt-v1', $4)
    `, [quizId, randomUUID(), ownerId, 'a'.repeat(64)]);
    await db.client.query(`
      INSERT INTO "quiz"."questions"
        ("id", "quiz_id", "owner_id", "chunk_id", "chunk_index", "ordinal", "stem", "explanation", "citation_ref", "idempotency_key")
      VALUES ($1, $2, $3, $4, 0, 0, 'Question?', 'Explanation', $5::jsonb, $6)
    `, [
      questionId,
      quizId,
      ownerId,
      chunkId,
      JSON.stringify({ chunkId, locator: { kind: 'page', page: 1 }, snippet: 'Source' }),
      'b'.repeat(64),
    ]);
    await db.client.query(`
      INSERT INTO "quiz"."options"
        ("id", "question_id", "owner_id", "option_index", "content", "is_correct")
      VALUES ($1, $2, $3, 0, 'Correct', true)
    `, [optionId, questionId, ownerId]);

    return { optionId, ownerId, questionId, quizId };
  }
});
