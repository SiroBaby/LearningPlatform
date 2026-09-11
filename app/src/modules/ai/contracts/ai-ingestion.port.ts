import { JobType } from '../enums/job-type.enum';
import type { DocumentModelSelection } from './model-selection.contracts';

export const MEDIA_PROBE_JOB_TYPE = 'MEDIA_PROBE' as const;

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
  /** Immutable object identity captured during media confirmation. */
  readonly sourceVersionId: string;
  readonly sourceEtag: string;
  readonly sourceContentLength: number;
}

export interface DocumentCancellationCommand {
  readonly deletionFence: number;
  readonly documentId: string;
  readonly ownerId: string;
  readonly reason: 'DOCUMENT_DELETED';
}

export type EnqueueCommand = FullPipelineEnqueueCommand | MediaProbeEnqueueCommand;

export const AI_INGESTION = Symbol('AI_INGESTION');

export interface AiIngestion {
  cancelDocument(command: DocumentCancellationCommand): Promise<void>;
  enqueue(command: EnqueueCommand): Promise<void>;
}
