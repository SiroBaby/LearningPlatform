import { classes } from '@automapper/classes';
import { createMapper, type Mapper } from '@automapper/core';
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  AttemptHistoryResult,
  GradedAttemptResult,
  GradedQuestionResult,
  PersistedAttemptQuestionResult,
  PersistedAttemptResult,
  PracticeFeedbackResult,
  QuizSummaryResult,
  ServedOptionResult,
  ServedQuestionResult,
  ServedQuizResult,
} from '../contracts/quiz-attempt.result';
import { GradedAttemptResponseDto } from '../dto/graded-attempt.response.dto';
import {
  AttemptHistoryResponseDto,
  AttemptResultResponseDto,
} from '../dto/attempt-result.response.dto';
import { QuizResponseDto } from '../dto/quiz.response.dto';
import { PracticeFeedbackResponseDto } from '../dto/practice-feedback.response.dto';
import { QuizSummaryResponseDto } from '../dto/quiz-summary.response.dto';
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

  it('maps Quiz summaries with the public id field', () => {
    const summary = Object.assign(new QuizSummaryResult(), {
      documentId: 'd9c63d87-9ec5-4f00-9ab7-32d35a5b1e7e',
      questionCount: 5,
      quizId: '4e248637-40c9-4d58-9de3-8d230fe56309',
    });

    expect(mapper.map(summary, QuizSummaryResult, QuizSummaryResponseDto)).toEqual({
      documentId: summary.documentId,
      id: summary.quizId,
      questionCount: summary.questionCount,
    });
  });

  it('maps attempt history as one top-level item with UTC submission time', () => {
    const attempt = Object.assign(new AttemptHistoryResult(), {
      id: 'aeb863c3-78ba-4e38-b86e-a5f04b9f8fc5',
      questionCount: 5,
      quizId: '4e248637-40c9-4d58-9de3-8d230fe56309',
      score: 4,
      submittedAt: new Date('2026-07-16T00:00:00.000Z'),
    });

    expect(mapper.map(attempt, AttemptHistoryResult, AttemptHistoryResponseDto)).toEqual({
      attemptId: attempt.id,
      questionCount: attempt.questionCount,
      quizId: attempt.quizId,
      score: attempt.score,
      submittedAt: '2026-07-16T00:00:00.000Z',
    });
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

  it('maps practice feedback without disclosing a correct Option', () => {
    const feedback = Object.assign(new PracticeFeedbackResult(), {
      citation: {
        chunkId: 'ed9bf39e-8898-42f1-91b4-d45f6f7589de',
        locator: { kind: 'page', page: 1 },
        snippet: 'Source',
      },
      explanation: 'Explanation',
      isCorrect: false,
      questionId: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
      selectedOptionId: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
    });

    const actual = mapper.map(feedback, PracticeFeedbackResult, PracticeFeedbackResponseDto);

    expect(actual).toEqual({
      citation: feedback.citation,
      explanation: feedback.explanation,
      isCorrect: false,
      questionId: feedback.questionId,
      selectedOptionId: feedback.selectedOptionId,
    });
    expect(JSON.stringify(actual)).not.toContain('correctOptionId');
    expect(JSON.stringify(actual)).not.toContain('correctOptionContent');
  });

  it('maps a persisted Attempt result with its Quiz and UTC submission time', () => {
    const result = Object.assign(new PersistedAttemptQuestionResult(), {
      citation: {
        chunkId: 'ed9bf39e-8898-42f1-91b4-d45f6f7589de',
        locator: { kind: 'page', page: 1 },
        snippet: 'Source',
      },
      correctOptionContent: 'Correct',
      correctOptionId: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
      explanation: 'Explanation',
      isCorrect: true,
      ordinal: 0,
      questionId: 'f387b115-f93f-4e21-8c8e-6433b155d55d',
      selectedOptionContent: 'Correct',
      selectedOptionId: '5a8bc836-a508-4b2f-8bea-a0ee2518bbb6',
      stem: 'Question?',
    });
    const attempt = Object.assign(new PersistedAttemptResult(), {
      id: 'aeb863c3-78ba-4e38-b86e-a5f04b9f8fc5',
      questionCount: 1,
      quizId: '4e248637-40c9-4d58-9de3-8d230fe56309',
      results: [result],
      score: 1,
      submittedAt: new Date('2026-07-16T00:00:00.000Z'),
    });

    const actual = mapper.map(attempt, PersistedAttemptResult, AttemptResultResponseDto);

    expect(actual).toEqual({
      attemptId: attempt.id,
      questionCount: 1,
      quizId: attempt.quizId,
      results: [result],
      score: 1,
      submittedAt: '2026-07-16T00:00:00.000Z',
    });
  });
});
