import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  QUIZ_GENERATION_HANDOFF,
  type PersistedQuiz,
  type QuizGenerationHandoff,
  type QuizGenerationHandoffPort,
} from './contracts/quiz-generation-handoff.contract';
import {
  QUIZ_PERSISTENCE,
  type QuizPersistence,
} from './contracts/quiz-persistence.port';
import { AssessmentError, AssessmentErrorCode } from './domain/assessment.error';
import { Quiz } from './domain/quiz';

@Injectable()
export class QuizGenerationHandoffService implements QuizGenerationHandoffPort {
  private readonly logger = new Logger(QuizGenerationHandoffService.name);

  constructor(@Inject(QUIZ_PERSISTENCE) private readonly quizzes: QuizPersistence) {}

  async persist(handoff: QuizGenerationHandoff): Promise<PersistedQuiz> {
    let quiz: Quiz;
    try {
      quiz = Quiz.create(handoff);
    } catch (error) {
      if (
        error instanceof AssessmentError &&
        error.code === AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS
      ) {
        this.logRejectedQuestions(
          error.acceptedQuestionCount ?? 0,
          error.totalQuestionCount ?? handoff.questions.length,
        );
      }
      throw error;
    }
    const droppedQuestionCount = handoff.questions.length - quiz.questions.length;
    if (droppedQuestionCount > 0) {
      this.logRejectedQuestions(quiz.questions.length, handoff.questions.length);
    }
    return this.quizzes.persist(quiz);
  }

  private logRejectedQuestions(acceptedQuestionCount: number, totalQuestionCount: number): void {
    this.logger.warn('Generated questions rejected by aggregate validation', {
      acceptedQuestionCount,
      droppedQuestionCount: totalQuestionCount - acceptedQuestionCount,
      totalQuestionCount,
    });
  }
}

export { QUIZ_GENERATION_HANDOFF };
