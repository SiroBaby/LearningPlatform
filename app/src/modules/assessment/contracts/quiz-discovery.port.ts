export const QUIZ_DISCOVERY = Symbol('QUIZ_DISCOVERY');

export interface QuizDiscoverySummary {
  readonly documentId: string;
  readonly questionCount: number;
  readonly quizId: string;
}

export interface QuizDiscovery {
  findByOwnerAndDocumentId(
    ownerId: string,
    documentId: string,
  ): Promise<QuizDiscoverySummary | null>;
}
