import { randomUUID } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import type { GradingQuiz } from '../contracts/quiz-attempt-store.port';
import { gradeAttempt, gradePracticeFeedback } from './attempt';

describe('practice feedback grading', () => {
  const quizId = randomUUID();
  const firstQuestionId = randomUUID();
  const secondQuestionId = randomUUID();
  const correctOptionId = randomUUID();
  const wrongOptionId = randomUUID();
  const otherQuestionOptionId = randomUUID();
  const quiz = createQuiz();

  it('returns feedback for one selected Option without requiring every Question', () => {
    const actual = gradePracticeFeedback({
      quiz,
      selection: { optionId: correctOptionId, questionId: firstQuestionId },
    });

    expect(actual).toEqual({
      feedback: {
        citation: quiz.questions[0].citation,
        explanation: 'Explanation 0',
        isCorrect: true,
        questionId: firstQuestionId,
        selectedOptionId: correctOptionId,
      },
      kind: 'graded',
    });
  });

  it.each([
    { optionId: correctOptionId, questionId: randomUUID() },
    { optionId: otherQuestionOptionId, questionId: firstQuestionId },
  ])('rejects a foreign Question or Option', (selection) => {
    expect(gradePracticeFeedback({ quiz, selection })).toEqual({ kind: 'invalid' });
  });

  it('preserves the full attempt requirement for every Question', () => {
    const actual = gradeAttempt({
      attemptId: randomUUID(),
      ownerId: randomUUID(),
      quiz,
      selections: [{ optionId: correctOptionId, questionId: firstQuestionId }],
    });

    expect(actual).toEqual({ kind: 'invalid' });
  });

  function createQuiz(): GradingQuiz {
    return {
      id: quizId,
      questions: [
        question(firstQuestionId, correctOptionId, wrongOptionId, 0),
        question(secondQuestionId, otherQuestionOptionId, randomUUID(), 1),
      ],
    };
  }

  function question(
    id: string,
    correctId: string,
    incorrectId: string,
    ordinal: number,
  ): GradingQuiz['questions'][number] {
    return {
      citation: {
        chunkId: randomUUID(),
        locator: { kind: 'page', page: ordinal + 1 },
        snippet: `Source ${ordinal}`,
      },
      explanation: `Explanation ${ordinal}`,
      id,
      ordinal,
      options: [
        { content: 'Correct', id: correctId, isCorrect: true, optionIndex: 0 },
        { content: 'Incorrect', id: incorrectId, isCorrect: false, optionIndex: 1 },
      ],
      stem: `Question ${ordinal}`,
    };
  }
});
