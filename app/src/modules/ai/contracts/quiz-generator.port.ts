import type { ChunkRecord } from './chunk.contracts';

export const QUIZ_GENERATOR = Symbol('QUIZ_GENERATOR');

export interface GenerateQuizCommand {
  readonly chunks: readonly ChunkRecord[];
  readonly job: {
    readonly documentId: string;
    readonly ownerId: string;
  };
}

export interface QuizGenerator {
  generate(command: GenerateQuizCommand): Promise<void>;
}
