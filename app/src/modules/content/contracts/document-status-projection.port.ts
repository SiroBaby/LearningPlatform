import { DocumentStatus } from '../enums/document-status.enum';
import type {
  DocumentProcessingFailureCode,
  DocumentProcessingUsage,
} from '../../ai/contracts/document-processing-result';

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

export type DocumentExtractionCompletionOutcome = DocumentProbeCompletionOutcome;

/** What Go measured in a TEXT_EXTRACT job (ADR-0033); the Node projection prices it and reserves. */
export interface DocumentExtractionCompletionCommand {
  readonly chunkCount: number;
  readonly deletionFence: number;
  readonly documentId: string;
  readonly eventCreatedAt: Date;
  readonly extractedChars: number;
  readonly fullPipelineJobId: string;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

/** Priced from the real text by the projection service; the repository only reserves and persists it. */
export type DocumentExtractionCreditEstimate =
  | { readonly kind: 'ESTIMATED'; readonly estimatedCredits: number; readonly platformModelId: string | null }
  /** The model is not configured or the measurement is unusable: fail terminally, reserve nothing. */
  | { readonly kind: 'UNAVAILABLE' };

export interface DocumentExtractionCompletionPersistenceCommand extends DocumentExtractionCompletionCommand {
  readonly creditEstimate: DocumentExtractionCreditEstimate;
}

export interface DocumentStatusProjection {
  completeExtraction(command: DocumentExtractionCompletionCommand): Promise<DocumentExtractionCompletionOutcome>;
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

/** Credit estimate computed from the probed duration; the repository only persists and reserves it. */
export type DocumentProbeCreditEstimate =
  | {
    readonly kind: 'ESTIMATED';
    readonly estimatedCredits: number;
    /** Platform model the estimate was priced for; the repository ignores the probe if the Document changed model. */
    readonly platformModelId: string | null;
  }
  | {
    /** No estimate can be made: the repository fails the Document terminally and reserves nothing. */
    readonly kind: 'UNAVAILABLE';
    readonly errorCode:
      | DocumentProcessingFailureCode.MEDIA_PRICING_UNAVAILABLE
      | DocumentProcessingFailureCode.MEDIA_PROBE_FAILED;
  };

export interface DocumentProbeCompletionPersistenceCommand extends DocumentProbeCompletionCommand {
  readonly creditEstimate: DocumentProbeCreditEstimate;
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
  readonly locator?: DocumentProbeLocator;
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
  /** ai.outbox aggregate id = the Go FULL_PIPELINE job id; must equal the Document's fullPipelineJobId to settle. */
  readonly jobId: string | null;
  readonly leaseId: string | null;
  readonly ownerId: string;
  readonly settledCredits: number | null;
  readonly status: DocumentStatus.READY | DocumentStatus.FAILED;
  /** Actual usage reported by Go; null for payloads written before usage reporting. */
  readonly usage: DocumentProcessingUsage | null;
}

/**
 * How the reservation of the finished attempt must be settled. Computed from the reported usage by the projection
 * service; the repository applies it atomically with the Document projection (keys use the Document's processingAttempt).
 */
export interface DocumentSettlementPlan {
  readonly hasUncertainDispatch: boolean;
  readonly knownActualCredits: number;
}

export interface DocumentStatusProjectionPersistenceCommand extends DocumentStatusProjectionCommand {
  readonly settlement: DocumentSettlementPlan | null;
}
