import type { PersistedAttemptResult } from './quiz-attempt-store.port';

export const ATTEMPT_RESULT_READER = Symbol('ATTEMPT_RESULT_READER');

export interface AttemptResultReader {
  findAllByOwnerAndQuizId(
    ownerId: string,
    quizId: string,
  ): Promise<readonly PersistedAttemptSummary[]>;

  findByOwnerQuizAndAttemptId(
    ownerId: string,
    quizId: string,
    attemptId: string,
  ): Promise<PersistedAttemptResult | null>;
}

export interface PersistedAttemptSummary {
  readonly id: string;
  readonly questionCount: number;
  readonly quizId: string;
  readonly score: number;
  readonly submittedAt: Date;
}
