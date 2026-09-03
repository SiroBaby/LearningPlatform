import { randomUUID } from 'crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DataSource } from 'typeorm';

import type { PersistedAttempt } from '../contracts/quiz-attempt-store.port';
import { AttemptAnswerEntity } from '../entities/attempt-answer.entity';
import { AttemptEntity } from '../entities/attempt.entity';
import { QuestionEntity } from '../entities/question.entity';
import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../../test-support/test-db';
import { QuizRepository } from './quiz.repository';
import { AttemptResultRepository } from './attempt-result.repository';

describe('QuizRepository attempt flow', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let repository: QuizRepository;
  let attemptResults: AttemptResultRepository;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });
  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    repository = new QuizRepository(dataSource);
    attemptResults = new AttemptResultRepository(dataSource);
    await db.client.query('TRUNCATE "quiz"."quizzes" CASCADE');
  });
  afterEach(async () => { await dataSource?.destroy(); });

  it('serves an owner-scoped Quiz without correctness or grading evidence', async () => {
    const fixture = await insertQuizFixture();

    const quiz = await repository.findServedByOwnerId(fixture.ownerId, fixture.quizId);

    expect(quiz).toEqual({
      id: fixture.quizId,
      questions: [{
        id: fixture.questionId,
        ordinal: 0,
        options: [{ content: 'Correct', id: fixture.optionId, optionIndex: 0 }],
        stem: 'Question?',
      }],
    });
    expect(JSON.stringify(quiz)).not.toContain('isCorrect');
    expect(JSON.stringify(quiz)).not.toContain('explanation');
    await expect(repository.findServedByOwnerId(randomUUID(), fixture.quizId)).resolves.toBeNull();
  });

  it('loads grading evidence only for the owner', async () => {
    const fixture = await insertQuizFixture();

    const quiz = await repository.findForGradingByOwnerId(fixture.ownerId, fixture.quizId);

    expect(quiz?.questions[0]).toMatchObject({
      citation: fixture.citation,
      explanation: 'Explanation',
      options: [{ id: fixture.optionId, isCorrect: true }],
    });
    await expect(repository.findForGradingByOwnerId(randomUUID(), fixture.quizId)).resolves.toBeNull();
  });

  it('orders legacy duplicate ordinals by Question ID for serving and grading', async () => {
    const fixture = await insertQuizFixture();
    const secondChunkId = randomUUID();
    const secondQuestionId = randomUUID();
    await db.client.query(`
      INSERT INTO "quiz"."questions"
        ("id", "quiz_id", "owner_id", "chunk_id", "chunk_index", "ordinal", "stem", "explanation", "citation_ref", "idempotency_key")
      VALUES ($1, $2, $3, $4, 1, 0, 'Second question?', 'Second explanation', $5::jsonb, $6)
    `, [
      secondQuestionId,
      fixture.quizId,
      fixture.ownerId,
      secondChunkId,
      JSON.stringify({ ...fixture.citation, chunkId: secondChunkId }),
      randomHash(),
    ]);
    const expectedQuestionIds = [fixture.questionId, secondQuestionId].sort();

    const served = await repository.findServedByOwnerId(fixture.ownerId, fixture.quizId);
    const grading = await repository.findForGradingByOwnerId(fixture.ownerId, fixture.quizId);

    expect(served?.questions.map((question) => question.id)).toEqual(expectedQuestionIds);
    expect(grading?.questions.map((question) => question.id)).toEqual(expectedQuestionIds);
  });

  it('discovers only the owned Quiz summary for a Document', async () => {
    const fixture = await insertQuizFixture();

    await expect(
      repository.findByOwnerAndDocumentId(fixture.ownerId, fixture.documentId),
    ).resolves.toEqual({
      documentId: fixture.documentId,
      questionCount: 1,
      quizId: fixture.quizId,
    });
    await expect(
      repository.findByOwnerAndDocumentId(randomUUID(), fixture.documentId),
    ).resolves.toBeNull();
  });

  it('lists owned Quiz summaries with counts from one owner-scoped aggregate query', async () => {
    const fixture = await insertQuizFixture();
    const secondQuizId = randomUUID();
    const secondDocumentId = randomUUID();
    const foreignQuizId = randomUUID();
    const foreignOwnerId = randomUUID();
    await db.client.query(`
      INSERT INTO "quiz"."quizzes"
        ("id", "document_id", "owner_id", "prompt_version", "idempotency_key")
      VALUES ($1, $2, $3, 'prompt-v1', $4), ($5, $6, $7, 'prompt-v1', $8)
    `, [
      secondQuizId,
      secondDocumentId,
      fixture.ownerId,
      randomHash(),
      foreignQuizId,
      randomUUID(),
      foreignOwnerId,
      randomHash(),
    ]);
    const querySpy = jest.spyOn(dataSource, 'query');

    try {
      const summaries = await repository.findAllByOwnerId(fixture.ownerId);

      expect(summaries).toEqual(expect.arrayContaining([
        { documentId: fixture.documentId, questionCount: 1, quizId: fixture.quizId },
        { documentId: secondDocumentId, questionCount: 0, quizId: secondQuizId },
      ]));
      expect(summaries).toHaveLength(2);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(querySpy.mock.calls[0]?.[0]).toContain('COUNT("question"."id")');
      expect(querySpy.mock.calls[0]?.[0]).toContain('"quiz"."owner_id" = $1');
      expect(querySpy.mock.calls[0]?.[0]).toContain('"question"."owner_id" = $1');
      await expect(repository.findAllByOwnerId(randomUUID())).resolves.toEqual([]);
    } finally {
      querySpy.mockRestore();
    }
  });

  it('persists an Attempt and its answers atomically', async () => {
    const fixture = await insertQuizFixture();
    const attempt = persistedAttempt(fixture);

    await expect(repository.persistAttempt(attempt)).resolves.toBe(true);

    expect(await dataSource.getRepository(AttemptEntity).findOneBy({ id: attempt.id })).toMatchObject({
      ownerId: fixture.ownerId,
      questionCount: 1,
      quizId: fixture.quizId,
      score: 1,
    });
    expect(await dataSource.getRepository(AttemptAnswerEntity).find()).toEqual([
      expect.objectContaining({
        attemptId: attempt.id,
        isCorrect: true,
        ownerId: fixture.ownerId,
        questionId: fixture.questionId,
        selectedOptionId: fixture.optionId,
      }),
    ]);
  });

  it('finds a persisted Attempt result only for its Owner and Quiz', async () => {
    const fixture = await insertQuizFixture();
    const attempt = persistedAttempt(fixture);
    await repository.persistAttempt(attempt);

    await expect(
      attemptResults.findByOwnerQuizAndAttemptId(fixture.ownerId, fixture.quizId, attempt.id),
    ).resolves.toMatchObject({
      id: attempt.id,
      questionCount: 1,
      quizId: fixture.quizId,
      results: [{
        citation: fixture.citation,
        correctOptionContent: 'Correct',
        correctOptionId: fixture.optionId,
        explanation: 'Explanation',
        isCorrect: true,
        ordinal: 0,
        questionId: fixture.questionId,
        selectedOptionContent: 'Correct',
        selectedOptionId: fixture.optionId,
        stem: 'Question?',
      }],
      score: 1,
    });
    await expect(
      attemptResults.findByOwnerQuizAndAttemptId(randomUUID(), fixture.quizId, attempt.id),
    ).resolves.toBeNull();
    await expect(
      attemptResults.findByOwnerQuizAndAttemptId(fixture.ownerId, randomUUID(), attempt.id),
    ).resolves.toBeNull();
  });

  it('keeps selected option content scoped to each result Question', async () => {
    const fixture = await insertQuizFixture();
    const secondQuestionId = randomUUID();
    const secondOptionId = randomUUID();
    const attemptId = randomUUID();
    await db.client.query(`
      INSERT INTO "quiz"."questions"
        ("id", "quiz_id", "owner_id", "chunk_id", "chunk_index", "ordinal", "stem", "explanation", "citation_ref", "idempotency_key")
      VALUES ($1, $2, $3, $4, 1, 1, 'Second question?', 'Second explanation', $5::jsonb, $6)
    `, [
      secondQuestionId,
      fixture.quizId,
      fixture.ownerId,
      fixture.citation.chunkId,
      JSON.stringify(fixture.citation),
      randomHash(),
    ]);
    await db.client.query(`
      INSERT INTO "quiz"."options"
        ("id", "question_id", "owner_id", "option_index", "content", "is_correct")
      VALUES ($1, $2, $3, 0, 'Second correct', true)
    `, [secondOptionId, secondQuestionId, fixture.ownerId]);
    await dataSource.getRepository(AttemptEntity).save({
      id: attemptId,
      ownerId: fixture.ownerId,
      questionCount: 2,
      quizId: fixture.quizId,
      score: 2,
    });
    await dataSource.getRepository(AttemptAnswerEntity).save([
      {
        attemptId,
        isCorrect: true,
        ownerId: fixture.ownerId,
        questionId: fixture.questionId,
        selectedOptionId: fixture.optionId,
      },
      {
        attemptId,
        isCorrect: true,
        ownerId: fixture.ownerId,
        questionId: secondQuestionId,
        selectedOptionId: secondOptionId,
      },
    ]);

    const result = await attemptResults.findByOwnerQuizAndAttemptId(
      fixture.ownerId,
      fixture.quizId,
      attemptId,
    );

    expect(result?.results).toEqual([
      expect.objectContaining({
        questionId: fixture.questionId,
        selectedOptionContent: 'Correct',
        selectedOptionId: fixture.optionId,
      }),
      expect.objectContaining({
        questionId: secondQuestionId,
        selectedOptionContent: 'Second correct',
        selectedOptionId: secondOptionId,
      }),
    ]);
  });

  it('rolls back the Attempt when an answer insert fails', async () => {
    const fixture = await insertQuizFixture();
    const attempt = persistedAttempt(fixture);
    await db.client.query(`
      CREATE FUNCTION "quiz"."reject_attempt_answer_insert"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test answer persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "reject_attempt_answer_insert"
        BEFORE INSERT ON "quiz"."attempt_answers"
        FOR EACH ROW EXECUTE FUNCTION "quiz"."reject_attempt_answer_insert"();
    `);

    try {
      await expect(repository.persistAttempt(attempt)).rejects.toThrow('test answer persistence failure');
      expect(await dataSource.getRepository(AttemptEntity).count()).toBe(0);
      expect(await dataSource.getRepository(AttemptAnswerEntity).count()).toBe(0);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS "reject_attempt_answer_insert" ON "quiz"."attempt_answers"');
      await db.client.query('DROP FUNCTION IF EXISTS "quiz"."reject_attempt_answer_insert"()');
    }
  });

  async function insertQuizFixture(): Promise<QuizFixture> {
    const fixture: QuizFixture = {
      citation: {
        chunkId: randomUUID(),
        locator: { kind: 'page', page: 1 },
        snippet: 'Source',
      },
      optionId: randomUUID(),
      documentId: randomUUID(),
      ownerId: randomUUID(),
      questionId: randomUUID(),
      quizId: randomUUID(),
    };
    await db.client.query(`
      INSERT INTO "quiz"."quizzes"
        ("id", "document_id", "owner_id", "prompt_version", "idempotency_key")
      VALUES ($1, $2, $3, 'prompt-v1', $4)
    `, [fixture.quizId, fixture.documentId, fixture.ownerId, randomHash()]);
    await db.client.query(`
      INSERT INTO "quiz"."questions"
        ("id", "quiz_id", "owner_id", "chunk_id", "chunk_index", "ordinal", "stem", "explanation", "citation_ref", "idempotency_key")
      VALUES ($1, $2, $3, $4, 0, 0, 'Question?', 'Explanation', $5::jsonb, $6)
    `, [
      fixture.questionId,
      fixture.quizId,
      fixture.ownerId,
      fixture.citation.chunkId,
      JSON.stringify(fixture.citation),
      randomHash(),
    ]);
    await db.client.query(`
      INSERT INTO "quiz"."options"
        ("id", "question_id", "owner_id", "option_index", "content", "is_correct")
      VALUES ($1, $2, $3, 0, 'Correct', true)
    `, [fixture.optionId, fixture.questionId, fixture.ownerId]);
    return fixture;
  }

  function persistedAttempt(fixture: QuizFixture): PersistedAttempt {
    return {
      id: randomUUID(),
      ownerId: fixture.ownerId,
      questionCount: 1,
      quizId: fixture.quizId,
      results: [{
        citation: fixture.citation,
        explanation: 'Explanation',
        isCorrect: true,
        questionId: fixture.questionId,
        selectedOptionId: fixture.optionId,
      }],
      score: 1,
    };
  }

  function randomHash(): string {
    return randomUUID().replaceAll('-', '').repeat(2);
  }
});

interface QuizFixture {
  readonly citation: {
    readonly chunkId: string;
    readonly locator: { readonly kind: 'page'; readonly page: number };
    readonly snippet: string;
  };
  readonly optionId: string;
  readonly documentId: string;
  readonly ownerId: string;
  readonly questionId: string;
  readonly quizId: string;
}
