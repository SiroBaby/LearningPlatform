import { classes } from '@automapper/classes';
import { createMapper, type Mapper } from '@automapper/core';
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  GradedAttemptResult,
  GradedQuestionResult,
  ServedOptionResult,
  ServedQuestionResult,
  ServedQuizResult,
} from '../contracts/quiz-attempt.result';
import { GradedAttemptResponseDto } from '../dto/graded-attempt.response.dto';
import { QuizResponseDto } from '../dto/quiz.response.dto';
import { AssessmentMappingProfile } from './assessment-mapping.profile';

describe('AssessmentMappingProfile', () => {
  let mapper: Mapper;

  beforeEach(() => {
    mapper = createMapper({ strategyInitializer: classes() });
    new AssessmentMappingProfile(mapper);
  });

  it('maps a served Quiz without correctness or grading evidence', () => {
    const option = Object.assign(new ServedOptionResult(), {
      content: 'Option',
      id: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
      optionIndex: 0,
    });
    const question = Object.assign(new ServedQuestionResult(), {
      id: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
      ordinal: 0,
      options: [option],
      stem: 'Question?',
    });
    const quiz = Object.assign(new ServedQuizResult(), {
      id: '4e248637-40c9-4d58-9de3-8d230fe56309',
      questions: [question],
    });

    const actual = mapper.map(quiz, ServedQuizResult, QuizResponseDto);

    expect(actual).toEqual({
      id: quiz.id,
      questions: [{
        id: question.id,
        ordinal: 0,
        options: [{ content: 'Option', id: option.id, optionIndex: 0 }],
        stem: 'Question?',
      }],
    });
    expect(JSON.stringify(actual)).not.toContain('isCorrect');
    expect(JSON.stringify(actual)).not.toContain('explanation');
    expect(JSON.stringify(actual)).not.toContain('citation');
  });

  it('maps graded results with correctness, explanation, and self-contained citation', () => {
    const chunkId = 'ed9bf39e-8898-42f1-91b4-d45f6f7589de';
    const gradedQuestion = Object.assign(new GradedQuestionResult(), {
      citation: {
        chunkId,
        locator: { kind: 'page', page: 1 },
        snippet: 'Source',
      },
      explanation: 'Explanation',
      isCorrect: true,
      questionId: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
      selectedOptionId: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
    });
    const attempt = Object.assign(new GradedAttemptResult(), {
      id: 'aeb863c3-78ba-4e38-b86e-a5f04b9f8fc5',
      questionCount: 1,
      results: [gradedQuestion],
      score: 1,
    });

    const actual = mapper.map(attempt, GradedAttemptResult, GradedAttemptResponseDto);

    expect(actual).toEqual({
      attemptId: attempt.id,
      questionCount: 1,
      results: [{
        citation: gradedQuestion.citation,
        explanation: 'Explanation',
        isCorrect: true,
        questionId: gradedQuestion.questionId,
        selectedOptionId: gradedQuestion.selectedOptionId,
      }],
      score: 1,
    });
  });
});
