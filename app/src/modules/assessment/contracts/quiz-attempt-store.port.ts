import type { CitationCandidate } from './quiz-generation-handoff.contract';

export const QUIZ_ATTEMPT_STORE = Symbol('QUIZ_ATTEMPT_STORE');

export interface AttemptSelection {
  readonly optionId: string;
  readonly questionId: string;
}

export interface ServedOption {
  readonly content: string;
  readonly id: string;
  readonly optionIndex: number;
}

export interface ServedQuestion {
  readonly id: string;
  readonly ordinal: number;
  readonly options: readonly ServedOption[];
  readonly stem: string;
}

export interface ServedQuiz {
  readonly id: string;
  readonly questions: readonly ServedQuestion[];
}

export interface GradingOption extends ServedOption {
  readonly isCorrect: boolean;
}

export interface GradingQuestion {
  readonly citation: CitationCandidate;
  readonly explanation: string;
  readonly id: string;
  readonly ordinal: number;
  readonly options: readonly GradingOption[];
  readonly stem: string;
}

export interface GradingQuiz {
  readonly id: string;
  readonly questions: readonly GradingQuestion[];
}

export interface GradedAnswer {
  readonly citation: CitationCandidate;
  readonly explanation: string;
  readonly isCorrect: boolean;
  readonly questionId: string;
  readonly selectedOptionId: string;
}

export interface PersistedAttempt {
  readonly id: string;
  readonly ownerId: string;
  readonly questionCount: number;
  readonly quizId: string;
  readonly results: readonly GradedAnswer[];
  readonly score: number;
}

export interface PersistedAttemptQuestionResult extends GradedAnswer {
  readonly correctOptionContent: string;
  readonly correctOptionId: string;
  readonly ordinal: number;
  readonly selectedOptionContent: string;
  readonly stem: string;
}

export interface PersistedAttemptResult {
  readonly id: string;
  readonly questionCount: number;
  readonly quizId: string;
  readonly results: readonly PersistedAttemptQuestionResult[];
  readonly score: number;
  readonly submittedAt: Date;
}

export interface QuizAttemptStore {
  findForGradingByOwnerId(ownerId: string, quizId: string): Promise<GradingQuiz | null>;
  findServedByOwnerId(ownerId: string, quizId: string): Promise<ServedQuiz | null>;
  persistAttempt(attempt: PersistedAttempt): Promise<boolean>;
}
