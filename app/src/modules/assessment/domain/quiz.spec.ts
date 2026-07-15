import { randomUUID } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import type {
  QuestionCandidate,
  QuizGenerationHandoff,
} from '../contracts/quiz-generation-handoff.contract';
import { AssessmentError, AssessmentErrorCode } from './assessment.error';
import { Quiz } from './quiz';

describe('Quiz', () => {
  it('drops invalid and duplicate-stem questions while preserving deterministic question IDs', () => {
    const handoff = validHandoff({
      questions: [
        candidate(0, 'What is established?'),
        { ...candidate(1, ' what  is established? '), ordinal: 1 },
        { ...candidate(2, 'Invalid option count'), options: [{ content: 'Only', isCorrect: true }] },
        candidate(3, 'What follows?'),
      ],
    });

    const first = Quiz.create(handoff);
    const second = Quiz.create(handoff);

    expect(first.questions).toHaveLength(2);
    expect(new Set(first.questions.map((question) => question.id)).size).toBe(2);
    expect(first.questions.map((question) => question.id)).toEqual(second.questions.map((question) => question.id));
    expect(first.questions.map((question) => question.options.map((option) => option.id))).toEqual(
      second.questions.map((question) => question.options.map((option) => option.id)),
    );
    expect(first.questions.map((question) => question.citation)).toEqual([
      handoff.questions[0].citation,
      handoff.questions[3].citation,
    ]);
  });

  it('throws a stable typed error when valid candidates fall below the floor', () => {
    const handoff = validHandoff({
      minimumQuestionCount: 2,
      questions: [
        { ...candidate(0, 'Invalid'), options: [{ content: 'Only', isCorrect: true }] },
      ],
    });

    try {
      Quiz.create(handoff);
      throw new Error('Expected Quiz.create to reject the handoff');
    } catch (error) {
      expect(error).toBeInstanceOf(AssessmentError);
      if (error instanceof AssessmentError) {
        expect(error.code).toBe(AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS);
      } else {
        throw error;
      }
    }
  });

  function validHandoff(change: Partial<QuizGenerationHandoff> = {}): QuizGenerationHandoff {
    return {
      documentId: randomUUID(),
      ownerId: randomUUID(),
      promptVersion: '9d4ec4d67c4f1f60d3d7f2a888e3ceacaf49a9f6531f0b2f6aa8ccbc80f70cc9',
      minimumQuestionCount: 1,
      questions: [candidate(0, 'What is established?')],
      ...change,
    };
  }

  function candidate(ordinal: number, stem: string): QuestionCandidate {
    const chunkId = randomUUID();
    return {
      chunkId,
      chunkIndex: ordinal,
      ordinal,
      stem,
      explanation: `Explanation ${ordinal}`,
      options: [
        { content: `Correct ${ordinal}`, isCorrect: true },
        { content: `Incorrect ${ordinal}`, isCorrect: false },
      ],
      citation: {
        chunkId,
        locator: { kind: 'page', page: ordinal + 1 },
        snippet: `Snippet ${ordinal}`,
      },
    };
  }
});
