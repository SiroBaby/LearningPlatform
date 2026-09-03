import { randomUUID } from 'crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  QUIZ_ATTEMPT_STORE,
  type AttemptSelection,
  type QuizAttemptStore,
} from './contracts/quiz-attempt-store.port';
import {
  ATTEMPT_RESULT_READER,
  type AttemptResultReader,
} from './contracts/attempt-result-reader.port';
import {
  QUIZ_DISCOVERY,
  type QuizDiscovery,
} from './contracts/quiz-discovery.port';
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
} from './contracts/quiz-attempt.result';
import { gradeAttempt, gradePracticeFeedback } from './domain/attempt';

@Injectable()
export class AssessmentService {
  constructor(
    @Inject(QUIZ_ATTEMPT_STORE)
    private readonly store: QuizAttemptStore,
    @Inject(ATTEMPT_RESULT_READER)
    private readonly attempts: AttemptResultReader,
    @Inject(QUIZ_DISCOVERY)
    private readonly quizzes: QuizDiscovery,
  ) {}

  async getQuizzes(ownerId: string): Promise<QuizSummaryResult[]> {
    const quizzes = await this.quizzes.findAllByOwnerId(ownerId);
    return quizzes.map((quiz) => Object.assign(new QuizSummaryResult(), quiz));
  }

  async getAttemptHistory(ownerId: string, quizId: string): Promise<AttemptHistoryResult[]> {
    const quiz = await this.store.findServedByOwnerId(ownerId, quizId);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    const attempts = await this.attempts.findAllByOwnerAndQuizId(ownerId, quizId);
    return attempts.map((attempt) => Object.assign(new AttemptHistoryResult(), {
      id: attempt.id,
      questionCount: attempt.questionCount,
      quizId: attempt.quizId,
      score: attempt.score,
      submittedAt: attempt.submittedAt,
    }));
  }

  async getQuiz(ownerId: string, quizId: string): Promise<ServedQuizResult> {
    const quiz = await this.store.findServedByOwnerId(ownerId, quizId);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    return Object.assign(new ServedQuizResult(), {
      id: quiz.id,
      questions: quiz.questions.map((question) => Object.assign(new ServedQuestionResult(), {
        id: question.id,
        ordinal: question.ordinal,
        options: question.options.map((option) => Object.assign(new ServedOptionResult(), option)),
        stem: question.stem,
      })),
    });
  }

  async submitAttempt(
    ownerId: string,
    quizId: string,
    selections: readonly AttemptSelection[],
  ): Promise<GradedAttemptResult> {
    const quiz = await this.store.findForGradingByOwnerId(ownerId, quizId);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }

    const result = gradeAttempt({
      attemptId: randomUUID(),
      ownerId,
      quiz,
      selections,
    });
    if (result.kind === 'invalid') {
      throw new BadRequestException('Every Question must have one valid selected Option');
    }

    const persisted = await this.store.persistAttempt(result.attempt);
    if (!persisted) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    return Object.assign(new GradedAttemptResult(), {
      id: result.attempt.id,
      questionCount: result.attempt.questionCount,
      results: result.attempt.results.map((gradedResult) => Object.assign(
        new GradedQuestionResult(),
        gradedResult,
      )),
      score: result.attempt.score,
    });
  }

  async getPracticeFeedback(
    ownerId: string,
    quizId: string,
    selection: AttemptSelection,
  ): Promise<PracticeFeedbackResult> {
    const quiz = await this.store.findForGradingByOwnerId(ownerId, quizId);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    const result = gradePracticeFeedback({ quiz, selection });
    if (result.kind === 'invalid') {
      throw new BadRequestException('Selected Option must belong to the specified Question');
    }
    return Object.assign(new PracticeFeedbackResult(), result.feedback);
  }

  async getAttemptResult(
    ownerId: string,
    quizId: string,
    attemptId: string,
  ): Promise<PersistedAttemptResult> {
    const attempt = await this.attempts.findByOwnerQuizAndAttemptId(ownerId, quizId, attemptId);
    if (!attempt) {
      throw new NotFoundException(`Attempt ${attemptId} not found`);
    }
    return Object.assign(new PersistedAttemptResult(), {
      id: attempt.id,
      questionCount: attempt.questionCount,
      quizId: attempt.quizId,
      results: attempt.results.map((result) => Object.assign(
        new PersistedAttemptQuestionResult(),
        result,
      )),
      score: attempt.score,
      submittedAt: attempt.submittedAt,
    });
  }
}
