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
  readonly authHeaders: (ownerId: string) => HeadersInit;
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

interface AttemptResultBody {
  readonly attemptId: string;
  readonly questionCount: number;
  readonly quizId: string;
  readonly results: readonly {
    readonly citation: unknown;
    readonly correctOptionContent: string;
    readonly correctOptionId: string;
    readonly explanation: string;
    readonly isCorrect: boolean;
    readonly ordinal: number;
    readonly questionId: string;
    readonly selectedOptionContent: string;
    readonly selectedOptionId: string;
    readonly stem: string;
  }[];
  readonly score: number;
  readonly submittedAt: string;
}

interface PracticeFeedbackBody {
  readonly citation: unknown;
  readonly explanation: string;
  readonly isCorrect: boolean;
  readonly questionId: string;
  readonly selectedOptionId: string;
}

export async function verifyQuizAttemptFlow(fixture: QuizAttemptFlowFixture): Promise<void> {
  const servedQuiz = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}`, {
    headers: fixture.authHeaders(fixture.ownerId),
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
    headers: fixture.authHeaders(fixture.otherOwnerId),
  });
  expect(hiddenQuiz.status).toBe(404);

  const correctOption = fixture.options.find((option) => option.isCorrect);
  if (!correctOption) {
    throw new Error('Quiz fixture requires one correct Option');
  }

  const incorrectOption = fixture.options.find((option) => !option.isCorrect);
  if (!incorrectOption) {
    throw new Error('Quiz fixture requires one incorrect Option');
  }

  const practiceFeedback = await fixture.request(
    `/api/v1/quizzes/${fixture.quiz.id}/practice-feedback`,
    {
      method: 'POST',
      headers: fixture.authHeaders(fixture.ownerId),
      body: JSON.stringify({ optionId: incorrectOption.id, questionId: fixture.question.id }),
    },
  );
  expect(practiceFeedback.status).toBe(200);
  const practiceBody = await practiceFeedback.json() as PracticeFeedbackBody;
  expect(practiceBody).toEqual({
    citation: fixture.question.citation,
    explanation: fixture.question.explanation,
    isCorrect: false,
    questionId: fixture.question.id,
    selectedOptionId: incorrectOption.id,
  });
  expect(JSON.stringify(practiceBody)).not.toContain('correctOptionId');
  expect(JSON.stringify(practiceBody)).not.toContain('correctOptionContent');
  expect(await fixture.dataSource.getRepository(AttemptEntity).count()).toBe(0);
  expect(await fixture.dataSource.getRepository(AttemptAnswerEntity).count()).toBe(0);

  const invalidPracticeFeedback = await fixture.request(
    `/api/v1/quizzes/${fixture.quiz.id}/practice-feedback`,
    {
      method: 'POST',
      headers: fixture.authHeaders(fixture.ownerId),
      body: JSON.stringify({ optionId: randomUUID(), questionId: fixture.question.id }),
    },
  );
  expect(invalidPracticeFeedback.status).toBe(400);

  const hiddenPracticeFeedback = await fixture.request(
    `/api/v1/quizzes/${fixture.quiz.id}/practice-feedback`,
    {
      method: 'POST',
      headers: fixture.authHeaders(fixture.otherOwnerId),
      body: JSON.stringify({ optionId: correctOption.id, questionId: fixture.question.id }),
    },
  );
  expect(hiddenPracticeFeedback.status).toBe(404);

  const submitted = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.authHeaders(fixture.ownerId),
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

  const persistedResult = await fixture.request(
    `/api/v1/quizzes/${fixture.quiz.id}/attempts/${graded.attemptId}`,
    { headers: fixture.authHeaders(fixture.ownerId) },
  );
  expect(persistedResult.status).toBe(200);
  const persistedBody = await persistedResult.json() as AttemptResultBody;
  expect(persistedBody).toMatchObject({
    attemptId: graded.attemptId,
    questionCount: 1,
    quizId: fixture.quiz.id,
    results: [{
      citation: fixture.question.citation,
      correctOptionContent: correctOption.content,
      correctOptionId: correctOption.id,
      explanation: fixture.question.explanation,
      isCorrect: true,
      ordinal: fixture.question.ordinal,
      questionId: fixture.question.id,
      selectedOptionContent: correctOption.content,
      selectedOptionId: correctOption.id,
      stem: fixture.question.stem,
    }],
    score: 1,
  });
  expect(persistedBody.submittedAt).toMatch(/Z$/);

  const hiddenPersistedResult = await fixture.request(
    `/api/v1/quizzes/${fixture.quiz.id}/attempts/${graded.attemptId}`,
    { headers: fixture.authHeaders(fixture.otherOwnerId) },
  );
  expect(hiddenPersistedResult.status).toBe(404);
  const mismatchedQuizResult = await fixture.request(
    `/api/v1/quizzes/${randomUUID()}/attempts/${graded.attemptId}`,
    { headers: fixture.authHeaders(fixture.ownerId) },
  );
  expect(mismatchedQuizResult.status).toBe(404);

  const invalidAttempt = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.authHeaders(fixture.ownerId),
    body: JSON.stringify({
      answers: [{ optionId: randomUUID(), questionId: fixture.question.id }],
    }),
  });
  expect(invalidAttempt.status).toBe(400);
  expect(await fixture.dataSource.getRepository(AttemptEntity).count()).toBe(1);
  expect(await fixture.dataSource.getRepository(AttemptAnswerEntity).count()).toBe(1);

  const hiddenAttempt = await fixture.request(`/api/v1/quizzes/${fixture.quiz.id}/attempts`, {
    method: 'POST',
    headers: fixture.authHeaders(fixture.otherOwnerId),
    body: JSON.stringify({
      answers: [{ optionId: correctOption.id, questionId: fixture.question.id }],
    }),
  });
  expect(hiddenAttempt.status).toBe(404);
}
