import { JobType } from '../enums/job-type.enum';
import type { DocumentModelSelection } from './model-selection.contracts';

export interface EnqueueCommand {
  readonly correlationId: string;
  readonly documentId: string;
  readonly jobType: JobType;
  readonly ownerId: string;
  readonly selection?: DocumentModelSelection;
}

export const AI_INGESTION = Symbol('AI_INGESTION');

export interface AiIngestion {
  enqueue(command: EnqueueCommand): Promise<void>;
}
