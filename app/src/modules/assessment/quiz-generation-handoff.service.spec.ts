import { randomUUID } from 'crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import type {
  QuestionCandidate,
  QuizGenerationHandoff,
} from './contracts/quiz-generation-handoff.contract';
import { QuestionEntity } from './entities/question.entity';
import { QuestionOptionEntity } from './entities/question-option.entity';
import { QuizEntity } from './entities/quiz.entity';
import { QuizGenerationHandoffService } from './quiz-generation-handoff.service';
import { QuizRepository } from './repositories/quiz.repository';
import { startTestDb, TestDb } from '../../test-support/test-db';
import { Quiz } from './domain/quiz';

describe('QuizGenerationHandoffService', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let handoff: QuizGenerationHandoffService;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });
  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: db.container.getHost(),
      port: db.container.getPort(),
      username: db.container.getUsername(),
      password: db.container.getPassword(),
      database: db.container.getDatabase(),
      entities: [QuizEntity, QuestionEntity, QuestionOptionEntity],
      synchronize: false,
    });
    await dataSource.initialize();
    handoff = new QuizGenerationHandoffService(new QuizRepository(dataSource));
    await db.client.query('TRUNCATE "quiz"."options", "quiz"."questions", "quiz"."quizzes" CASCADE');
  });
  afterEach(async () => { await dataSource?.destroy(); });

  it('persists one self-contained Quiz with owner propagation and deterministic children', async () => {
    const input = validHandoff({
      minimumQuestionCount: 2,
      questions: [
        candidate(0),
        { ...candidate(1), options: [{ content: 'Only', isCorrect: true }] },
        candidate(2),
      ],
    });
    const aggregate = Quiz.create(input);
    expect(new Set(aggregate.questions.map((question) => question.id)).size).toBe(2);
    expect(aggregate.questions.map((question) => question.id)).not.toContain(aggregate.id);

    const first = await handoff.persist(input);
    const second = await handoff.persist({
      ...input,
      questions: [...input.questions, candidate(3)],
    });
    const quizzes = await dataSource.getRepository(QuizEntity).find();
    const questions = await dataSource.getRepository(QuestionEntity).find({ order: { ordinal: 'ASC' } });
    const options = await dataSource.getRepository(QuestionOptionEntity).find();

    expect(second).toEqual(first);
    expect(first).toMatchObject({ questionCount: 2, optionCount: 4 });
    expect(quizzes).toHaveLength(1);
    expect(quizzes[0]?.ownerId).toBe(input.ownerId);
    expect(questions.map((question) => question.ownerId)).toEqual([input.ownerId, input.ownerId]);
    expect(options.every((option) => option.ownerId === input.ownerId)).toBe(true);
    expect(questions.map((question) => question.citation)).toEqual([
      input.questions[0].citation,
      input.questions[2].citation,
    ]);
    expect(questions.map((question) => question.id)).toEqual(
      (await handoff.persist(input)).questionIds,
    );
  });

  it('rolls back the Quiz when a database trigger rejects a child Question', async () => {
    await db.client.query(`
      CREATE FUNCTION "quiz"."reject_question_insert"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test child persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER "reject_question_insert"
        BEFORE INSERT ON "quiz"."questions"
        FOR EACH ROW EXECUTE FUNCTION "quiz"."reject_question_insert"();
    `);

    try {
      await expect(handoff.persist(validHandoff())).rejects.toThrow('test child persistence failure');
      expect(await dataSource.getRepository(QuizEntity).count()).toBe(0);
      expect(await dataSource.getRepository(QuestionEntity).count()).toBe(0);
      expect(await dataSource.getRepository(QuestionOptionEntity).count()).toBe(0);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS "reject_question_insert" ON "quiz"."questions"');
      await db.client.query('DROP FUNCTION IF EXISTS "quiz"."reject_question_insert"()');
    }
  });

  it('creates a new Quiz when the prompt fingerprint changes', async () => {
    const input = validHandoff();

    const first = await handoff.persist(input);
    const second = await handoff.persist({
      ...input,
      promptVersion: 'c'.repeat(64),
    });

    expect(second.quizId).not.toBe(first.quizId);
    expect(await dataSource.getRepository(QuizEntity).count()).toBe(2);
    expect(await dataSource.getRepository(QuestionEntity).count()).toBe(2);
  });

  function validHandoff(change: Partial<QuizGenerationHandoff> = {}): QuizGenerationHandoff {
    return {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      promptVersion: '9d4ec4d67c4f1f60d3d7f2a888e3ceacaf49a9f6531f0b2f6aa8ccbc80f70cc9',
      minimumQuestionCount: 1,
      questions: [candidate(0)],
      ...change,
    };
  }

  function candidate(ordinal: number): QuestionCandidate {
    const chunkId = randomUUID();
    return {
      chunkId,
      chunkIndex: Math.max(ordinal, 0),
      ordinal,
      stem: `Question ${ordinal}`,
      explanation: `Explanation ${ordinal}`,
      options: [
        { content: `Correct ${ordinal}`, isCorrect: true },
        { content: `Incorrect ${ordinal}`, isCorrect: false },
      ],
      citation: {
        chunkId,
        locator: { kind: 'page', page: Math.max(ordinal, 0) + 1 },
        snippet: `Snippet ${ordinal}`,
      },
    };
  }
});
