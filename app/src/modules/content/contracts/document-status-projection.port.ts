import { DocumentStatus } from '../enums/document-status.enum';
import type { DocumentProcessingFailureCode } from '../../ai/contracts/document-processing-result';

export const DOCUMENT_STATUS_PROJECTION = Symbol('DOCUMENT_STATUS_PROJECTION');

export type DocumentStatusProjectionOutcome =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'IGNORED'
  | 'UNVERIFIED_LEGACY';

export interface DocumentStatusProjection {
  project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome>;
}

export interface DocumentStatusProjectionCommand {
  readonly attempt: number | null;
  readonly budgetStatus: string | null;
  readonly documentId: string;
  readonly estimatedCredits: number | null;
  readonly estimateStatus: string | null;
  readonly errorCode: DocumentProcessingFailureCode | null;
  readonly errorMessage: string | null;
  readonly eventCreatedAt: Date;
  readonly leaseId: string | null;
  readonly ownerId: string;
  readonly settledCredits: number | null;
  readonly status: DocumentStatus.READY | DocumentStatus.FAILED;
}
