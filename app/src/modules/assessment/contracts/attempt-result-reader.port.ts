import type { PersistedAttemptResult } from './quiz-attempt-store.port';

export const ATTEMPT_RESULT_READER = Symbol('ATTEMPT_RESULT_READER');

export interface AttemptResultReader {
  findByOwnerQuizAndAttemptId(
    ownerId: string,
    quizId: string,
    attemptId: string,
  ): Promise<PersistedAttemptResult | null>;
}
