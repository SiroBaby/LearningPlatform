import type { PersistedQuiz } from './quiz-generation-handoff.contract';
import type { Quiz } from '../domain/quiz';

export const QUIZ_PERSISTENCE = Symbol('QUIZ_PERSISTENCE');

export interface QuizPersistence {
  persist(quiz: Quiz): Promise<PersistedQuiz>;
}
