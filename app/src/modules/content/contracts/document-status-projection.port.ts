import { DocumentStatus } from '../enums/document-status.enum';
import type { DocumentProcessingFailureCode } from '../../ai/contracts/document-processing-result';

export const DOCUMENT_STATUS_PROJECTION = Symbol('DOCUMENT_STATUS_PROJECTION');

export type DocumentStatusProjectionOutcome =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'IGNORED'
  | 'UNVERIFIED_LEGACY';

export type DocumentProbeCompletionOutcome =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'IGNORED';

export type DocumentProbeFailureOutcome = DocumentProbeCompletionOutcome;

export interface DocumentStatusProjection {
  completeProbe(command: DocumentProbeCompletionCommand): Promise<DocumentProbeCompletionOutcome>;
  failProbe(command: DocumentProbeFailureCommand): Promise<DocumentProbeFailureOutcome>;
  project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome>;
}

export interface DocumentProbeCompletionCommand {
  readonly deletionFence: number;
  readonly documentId: string;
  readonly durationSec: number;
  readonly eventCreatedAt: Date;
  readonly fullPipelineJobId: string;
  readonly ownerId: string;
  readonly policyVersion: string;
  readonly probeResultId: string;
  readonly probeGeneration: string;
  readonly locator: DocumentProbeLocator;
}

/** Immutable storage identity carried by the AI return handoff. */
export interface DocumentProbeLocator {
  readonly bucket: string;
  readonly contentLength: number;
  readonly etag: string;
  readonly key: string;
  readonly versionId: string;
}

export interface DocumentProbeFailureCommand {
  readonly attempt: number;
  readonly deletionFence: number;
  readonly documentId: string;
  readonly errorCode: DocumentProcessingFailureCode;
  readonly errorMessage: string | null;
  readonly eventCreatedAt: Date;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly policyVersion: string;
  readonly probeGeneration: string;
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
