import type { ChunkRecord } from './chunk.contracts';
import type { DocumentModelSelection } from './model-selection.contracts';

export const QUIZ_GENERATOR = Symbol('QUIZ_GENERATOR');

export interface GenerateQuizCommand {
  readonly chunks: readonly ChunkRecord[];
  readonly job: {
    readonly attempt?: number;
    readonly correlationId: string;
    readonly documentId: string;
    readonly id?: string;
    readonly leaseId?: string;
    readonly ownerId: string;
    readonly selection?: DocumentModelSelection | null;
  };
}

export interface QuizGenerator {
  generate(command: GenerateQuizCommand): Promise<void>;
}
