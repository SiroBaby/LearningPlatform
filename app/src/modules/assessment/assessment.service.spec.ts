import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type {
  GradingQuiz,
  PersistedAttemptResult,
  QuizAttemptStore,
  ServedQuiz,
} from './contracts/quiz-attempt-store.port';
import type { AttemptResultReader } from './contracts/attempt-result-reader.port';
import { AssessmentService } from './assessment.service';

describe('AssessmentService', () => {
  const ownerId = randomUUID();
  const quizId = randomUUID();
  const firstQuestionId = randomUUID();
  const secondQuestionId = randomUUID();
  const firstCorrectOptionId = randomUUID();
  const firstWrongOptionId = randomUUID();
  const secondCorrectOptionId = randomUUID();
  const secondWrongOptionId = randomUUID();
  const persistedResult = persistedAttemptResult();
  let store: QuizAttemptStore;
  let attempts: AttemptResultReader;
  let service: AssessmentService;

  beforeEach(() => {
    store = {
      findForGradingByOwnerId: jest.fn(async () => gradingQuiz()),
      findServedByOwnerId: jest.fn(async () => servedQuiz()),
      persistAttempt: jest.fn(async () => true),
    };
    attempts = {
      findByOwnerQuizAndAttemptId: jest.fn(async () => persistedResult),
    };
    service = new AssessmentService(store, attempts);
  });

  it('serves only the quiz owned by the current Owner', async () => {
    await expect(service.getQuiz(ownerId, quizId)).resolves.toEqual(servedQuiz());
    expect(store.findServedByOwnerId).toHaveBeenCalledWith(ownerId, quizId);
  });

  it('returns not found when the owner-scoped Quiz lookup misses', async () => {
    store.findServedByOwnerId = jest.fn(async () => null);

    await expect(service.getQuiz(ownerId, quizId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns an owner-scoped persisted Attempt result', async () => {
    const attemptId = randomUUID();

    await expect(service.getAttemptResult(ownerId, quizId, attemptId)).resolves.toEqual(
      persistedResult,
    );
    expect(attempts.findByOwnerQuizAndAttemptId).toHaveBeenCalledWith(ownerId, quizId, attemptId);
  });

  it('returns not found when the owner-scoped persisted Attempt lookup misses', async () => {
    attempts.findByOwnerQuizAndAttemptId = jest.fn(async () => null);

    await expect(service.getAttemptResult(ownerId, quizId, randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('grades every Question in ordinal order and persists the Attempt', async () => {
    const actual = await service.submitAttempt(ownerId, quizId, [
      { questionId: secondQuestionId, optionId: secondWrongOptionId },
      { questionId: firstQuestionId, optionId: firstCorrectOptionId },
    ]);

    expect(actual.score).toBe(1);
    expect(actual.questionCount).toBe(2);
    expect(actual.results.map((result) => result.questionId)).toEqual([
      firstQuestionId,
      secondQuestionId,
    ]);
    expect(actual.results.map((result) => result.isCorrect)).toEqual([true, false]);
    expect(store.persistAttempt).toHaveBeenCalledWith(expect.objectContaining({
      ownerId,
      quizId,
      score: 1,
      questionCount: 2,
    }));
  });

  it('returns correct practice feedback without persisting an Attempt', async () => {
    const actual = await service.getPracticeFeedback(ownerId, quizId, {
      optionId: firstCorrectOptionId,
      questionId: firstQuestionId,
    });

    expect(actual).toEqual(expect.objectContaining({
      explanation: 'Explanation 0',
      isCorrect: true,
      questionId: firstQuestionId,
      selectedOptionId: firstCorrectOptionId,
    }));
    expect(actual.citation).toEqual(expect.objectContaining({
      locator: { kind: 'page', page: 1 },
      snippet: 'Source 0',
    }));
    expect(store.findForGradingByOwnerId).toHaveBeenCalledWith(ownerId, quizId);
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it('returns incorrect practice feedback without persisting an Attempt', async () => {
    const actual = await service.getPracticeFeedback(ownerId, quizId, {
      optionId: firstWrongOptionId,
      questionId: firstQuestionId,
    });

    expect(actual.isCorrect).toBe(false);
    expect(actual.selectedOptionId).toBe(firstWrongOptionId);
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { optionId: firstCorrectOptionId, questionId: randomUUID() },
    { optionId: secondCorrectOptionId, questionId: firstQuestionId },
  ])('rejects an invalid practice Question or Option without persisting', async (selection) => {
    await expect(service.getPracticeFeedback(ownerId, quizId, selection)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it('returns not found for a practice request to an inaccessible Quiz', async () => {
    store.findForGradingByOwnerId = jest.fn(async () => null);

    await expect(service.getPracticeFeedback(ownerId, quizId, {
      optionId: firstCorrectOptionId,
      questionId: firstQuestionId,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it.each([
    {
      answers: [{ questionId: firstQuestionId, optionId: firstCorrectOptionId }],
      reason: 'a missing answer',
    },
    {
      answers: [
        { questionId: firstQuestionId, optionId: firstCorrectOptionId },
        { questionId: firstQuestionId, optionId: firstWrongOptionId },
      ],
      reason: 'a duplicate Question',
    },
    {
      answers: [
        { questionId: randomUUID(), optionId: firstCorrectOptionId },
        { questionId: secondQuestionId, optionId: secondCorrectOptionId },
      ],
      reason: 'a foreign Question',
    },
    {
      answers: [
        { questionId: firstQuestionId, optionId: secondCorrectOptionId },
        { questionId: secondQuestionId, optionId: secondCorrectOptionId },
      ],
      reason: 'an Option from another Question',
    },
  ])('rejects $reason without persisting', async ({ answers }) => {
    await expect(service.submitAttempt(ownerId, quizId, answers)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it('returns not found and persists nothing when the Quiz is not owner-accessible', async () => {
    store.findForGradingByOwnerId = jest.fn(async () => null);

    await expect(service.submitAttempt(ownerId, quizId, [])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(store.persistAttempt).not.toHaveBeenCalled();
  });

  it('returns not found when ownership changes before the transactional write', async () => {
    store.persistAttempt = jest.fn(async () => false);

    await expect(service.submitAttempt(ownerId, quizId, validAnswers())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  function validAnswers(): readonly { readonly optionId: string; readonly questionId: string }[] {
    return [
      { questionId: firstQuestionId, optionId: firstCorrectOptionId },
      { questionId: secondQuestionId, optionId: secondCorrectOptionId },
    ];
  }

  function servedQuiz(): ServedQuiz {
    return {
      id: quizId,
      questions: gradingQuiz().questions.map((question) => ({
        id: question.id,
        ordinal: question.ordinal,
        options: question.options.map((option) => ({
          content: option.content,
          id: option.id,
          optionIndex: option.optionIndex,
        })),
        stem: question.stem,
      })),
    };
  }

  function gradingQuiz(): GradingQuiz {
    return {
      id: quizId,
      questions: [
        gradingQuestion(firstQuestionId, firstCorrectOptionId, firstWrongOptionId, 0),
        gradingQuestion(secondQuestionId, secondCorrectOptionId, secondWrongOptionId, 1),
      ],
    };
  }

  function persistedAttemptResult(): PersistedAttemptResult {
    return {
      id: randomUUID(),
      questionCount: 2,
      quizId,
      results: [{
        citation: gradingQuiz().questions[0].citation,
        correctOptionContent: 'Correct',
        correctOptionId: firstCorrectOptionId,
        explanation: 'Explanation 0',
        isCorrect: true,
        ordinal: 0,
        questionId: firstQuestionId,
        selectedOptionContent: 'Correct',
        selectedOptionId: firstCorrectOptionId,
        stem: 'Question 0',
      }],
      score: 1,
      submittedAt: new Date('2026-07-16T00:00:00.000Z'),
    };
  }

  function gradingQuestion(
    id: string,
    correctOptionId: string,
    wrongOptionId: string,
    ordinal: number,
  ): GradingQuiz['questions'][number] {
    const chunkId = randomUUID();
    return {
      citation: {
        chunkId,
        locator: { kind: 'page', page: ordinal + 1 },
        snippet: `Source ${ordinal}`,
      },
      explanation: `Explanation ${ordinal}`,
      id,
      ordinal,
      options: [
        { content: 'Correct', id: correctOptionId, isCorrect: true, optionIndex: 0 },
        { content: 'Wrong', id: wrongOptionId, isCorrect: false, optionIndex: 1 },
      ],
      stem: `Question ${ordinal}`,
    };
  }
});
