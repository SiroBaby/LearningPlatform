import { JobType } from '../enums/job-type.enum';
import type { DocumentModelSelection } from './model-selection.contracts';

export const MEDIA_PROBE_JOB_TYPE = 'MEDIA_PROBE' as const;
/** Extract + chunk only (Go), so the real text size is known before credits are reserved (ADR-0033). */
export const TEXT_EXTRACT_JOB_TYPE = 'TEXT_EXTRACT' as const;

export interface FullPipelineEnqueueCommand {
  readonly correlationId: string;
  readonly documentId: string;
  readonly fullPipelineJobId?: string;
  readonly jobType: JobType.FULL_PIPELINE;
  readonly ownerId: string;
  readonly probeResultId?: string;
  readonly probeGeneration?: string;
  readonly policyVersion?: string;
  readonly deletionFence?: number;
  /** Logical attempt assigned by the course-side Document for media handoff. */
  readonly processingAttempt?: number;
  readonly selection?: DocumentModelSelection;
}

/** PDF/TXT Platform Model start: Go extracts and measures the text before any credit is reserved (ADR-0033). */
export interface TextExtractEnqueueCommand {
  readonly correlationId: string;
  readonly deletionFence: number;
  readonly documentId: string;
  /** The FULL_PIPELINE job the Node reservation will create; the extraction result carries it back. */
  readonly fullPipelineJobId: string;
  readonly jobType: typeof TEXT_EXTRACT_JOB_TYPE;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

export interface MediaProbeEnqueueCommand {
  readonly correlationId: string;
  readonly deletionFence: number;
  readonly documentId: string;
  readonly fullPipelineJobId: string;
  readonly jobType: typeof MEDIA_PROBE_JOB_TYPE;
  readonly ownerId: string;
  readonly policyVersion: string;
  readonly probeGeneration: string;
  readonly sourceBucket: string;
  readonly sourceKey: string;
  /** Present only when retrying a probe with its previously captured locator. */
  readonly sourceVersionId?: string;
  readonly sourceEtag?: string;
  readonly sourceContentLength?: number;
}

export interface DocumentCancellationCommand {
  readonly deletionFence: number;
  readonly documentId: string;
  readonly ownerId: string;
  readonly reason: 'DOCUMENT_DELETED';
}

export type EnqueueCommand = FullPipelineEnqueueCommand | MediaProbeEnqueueCommand | TextExtractEnqueueCommand;

export const AI_INGESTION = Symbol('AI_INGESTION');

export interface AiIngestion {
  cancelDocument(command: DocumentCancellationCommand): Promise<void>;
  enqueue(command: EnqueueCommand): Promise<void>;
}
