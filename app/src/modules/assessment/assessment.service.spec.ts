import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type {
  GradingQuiz,
  PersistedAttempt,
  QuizAttemptStore,
  ServedQuiz,
} from './contracts/quiz-attempt-store.port';
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
  let store: QuizAttemptStore;
  let service: AssessmentService;

  beforeEach(() => {
    store = {
      findForGradingByOwnerId: jest.fn(async () => gradingQuiz()),
      findServedByOwnerId: jest.fn(async () => servedQuiz()),
      persistAttempt: jest.fn(async () => true),
    };
    service = new AssessmentService(store);
  });

  it('serves only the quiz owned by the current Owner', async () => {
    await expect(service.getQuiz(ownerId, quizId)).resolves.toEqual(servedQuiz());
    expect(store.findServedByOwnerId).toHaveBeenCalledWith(ownerId, quizId);
  });

  it('returns not found when the owner-scoped Quiz lookup misses', async () => {
    store.findServedByOwnerId = jest.fn(async () => null);

    await expect(service.getQuiz(ownerId, quizId)).rejects.toBeInstanceOf(NotFoundException);
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
    store.persistAttempt = jest.fn(async (_attempt: PersistedAttempt) => false);

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
