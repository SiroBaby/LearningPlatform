import { randomUUID } from 'crypto';

import { expect } from '@jest/globals';
import type { DataSource } from 'typeorm';

import { AttemptAnswerEntity } from '../../src/modules/assessment/entities/attempt-answer.entity';
import { AttemptEntity } from '../../src/modules/assessment/entities/attempt.entity';
import type { QuestionOptionEntity } from '../../src/modules/assessment/entities/question-option.entity';
import type { QuestionEntity } from '../../src/modules/assessment/entities/question.entity';
import type { QuizEntity } from '../../src/modules/assessment/entities/quiz.entity';

interface QuizAttemptFlowFixture {
  readonly dataSource: DataSource;
  readonly options: readonly QuestionOptionEntity[];
  readonly otherOwnerId: string;
  readonly ownerHeaders: (ownerId: string) => HeadersInit;
  readonly ownerId: string;
  readonly question: QuestionEntity;
  readonly quiz: QuizEntity;
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
}

interface GradedAttemptBody {
  readonly attemptId: string;
  readonly questionCount: number;
  readonly results: readonly {
    readonly citation: unknown;
    readonly explanation: string;
    readonly isCorrect: boolean;
    readonly questionId: string;
    readonly selectedOptionId: string;
  }[];
  readonly score: number;
}

export async function verifyQuizAttemptFlow(fixture: QuizAttemptFlowFixture): Promise<void> {
  const servedQuiz = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}`, {
    headers: fixture.ownerHeaders(fixture.ownerId),
  });
  expect(servedQuiz.status).toBe(200);
  const servedBody = await servedQuiz.json();
  expect(servedBody).toMatchObject({
    id: fixture.quiz.id,
    questions: [{ id: fixture.question.id }],
  });
  expect(JSON.stringify(servedBody)).not.toContain('isCorrect');
  expect(JSON.stringify(servedBody)).not.toContain('is_correct');
  expect(JSON.stringify(servedBody)).not.toContain('explanation');

  const hiddenQuiz = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}`, {
    headers: fixture.ownerHeaders(fixture.otherOwnerId),
  });
  expect(hiddenQuiz.status).toBe(404);

  const correctOption = fixture.options.find((option) => option.isCorrect);
  if (!correctOption) {
    throw new Error('Quiz fixture requires one correct Option');
  }

  const submitted = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.ownerHeaders(fixture.ownerId),
    body: JSON.stringify({
      answers: [{ optionId: correctOption.id, questionId: fixture.question.id }],
    }),
  });
  expect(submitted.status).toBe(201);
  const graded = await submitted.json() as GradedAttemptBody;
  expect(graded).toMatchObject({
    questionCount: 1,
    results: [{
      citation: fixture.question.citation,
      explanation: fixture.question.explanation,
      isCorrect: true,
      questionId: fixture.question.id,
      selectedOptionId: correctOption.id,
    }],
    score: 1,
  });
  expect(
    await fixture.dataSource.getRepository(AttemptEntity).findOneBy({ id: graded.attemptId }),
  ).toMatchObject({
    ownerId: fixture.ownerId,
    questionCount: 1,
    quizId: fixture.quiz.id,
    score: 1,
  });
  expect(await fixture.dataSource.getRepository(AttemptAnswerEntity).find()).toEqual([
    expect.objectContaining({
      attemptId: graded.attemptId,
      isCorrect: true,
      ownerId: fixture.ownerId,
      questionId: fixture.question.id,
      selectedOptionId: correctOption.id,
    }),
  ]);

  const invalidAttempt = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.ownerHeaders(fixture.ownerId),
    body: JSON.stringify({
      answers: [{ optionId: randomUUID(), questionId: fixture.question.id }],
    }),
  });
  expect(invalidAttempt.status).toBe(400);
  expect(await fixture.dataSource.getRepository(AttemptEntity).count()).toBe(1);
  expect(await fixture.dataSource.getRepository(AttemptAnswerEntity).count()).toBe(1);

  const hiddenAttempt = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.ownerHeaders(fixture.otherOwnerId),
    body: JSON.stringify({
      answers: [{ optionId: correctOption.id, questionId: fixture.question.id }],
    }),
  });
  expect(hiddenAttempt.status).toBe(404);
}
