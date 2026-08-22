export const QUIZ_GENERATION_HANDOFF = Symbol('QUIZ_GENERATION_HANDOFF');

export type CitationLocator =
  | PageCitationLocator
  | TextRangeCitationLocator
  | TimeCitationLocator;

export interface PageCitationLocator {
  readonly kind: 'page';
  readonly page: number;
}

export interface TextRangeCitationLocator {
  readonly kind: 'text-range';
  readonly start: number;
  readonly end: number;
}

export interface TimeCitationLocator {
  readonly kind: 'time';
  readonly startSec: number;
  readonly endSec: number;
}

export interface CitationCandidate {
  readonly chunkId: string;
  readonly locator: CitationLocator;
  readonly snippet: string;
}

export interface QuestionOptionCandidate {
  readonly content: string;
  readonly isCorrect: boolean;
}

export interface QuestionCandidate {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly ordinal: number;
  readonly stem: string;
  readonly explanation: string;
  readonly options: readonly QuestionOptionCandidate[];
  readonly citation: CitationCandidate;
}

export interface QuizGenerationHandoff {
  readonly documentId: string;
  readonly ownerId: string;
  readonly promptVersion: string;
  readonly minimumQuestionCount: number;
  readonly questions: readonly QuestionCandidate[];
}

export interface PersistedQuiz {
  readonly quizId: string;
  readonly questionCount: number;
  readonly optionCount: number;
  readonly questionIds: readonly string[];
}

export interface QuizGenerationHandoffPort {
  persist(handoff: QuizGenerationHandoff): Promise<PersistedQuiz>;
}
