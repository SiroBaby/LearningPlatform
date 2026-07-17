import { DocumentStatus } from '../enums/document-status.enum';

export const DOCUMENT_STATUS_PROJECTION = Symbol('DOCUMENT_STATUS_PROJECTION');

export interface DocumentStatusProjection {
  project(command: DocumentStatusProjectionCommand): Promise<void>;
}

export interface DocumentStatusProjectionCommand {
  readonly budgetStatus: string | null;
  readonly documentId: string;
  readonly estimatedCredits: number | null;
  readonly estimateStatus: string | null;
  readonly errorMessage: string | null;
  readonly ownerId: string;
  readonly settledCredits: number | null;
  readonly status: DocumentStatus.READY | DocumentStatus.FAILED;
}
