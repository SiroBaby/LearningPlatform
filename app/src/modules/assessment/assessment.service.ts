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
  GradedAttemptResult,
  GradedQuestionResult,
  ServedOptionResult,
  ServedQuestionResult,
  ServedQuizResult,
} from './contracts/quiz-attempt.result';
import { gradeAttempt } from './domain/attempt';

@Injectable()
export class AssessmentService {
  constructor(
    @Inject(QUIZ_ATTEMPT_STORE)
    private readonly store: QuizAttemptStore,
  ) {}

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
}
