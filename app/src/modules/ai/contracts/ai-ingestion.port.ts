import { JobType } from '../enums/job-type.enum';

export interface EnqueueCommand {
  documentId: string;
  ownerId: string;
  jobType: JobType;
  correlationId: string;
}

export const AI_INGESTION = Symbol('AI_INGESTION');

export interface AiIngestion {
  enqueue(command: EnqueueCommand): Promise<void>;
}
