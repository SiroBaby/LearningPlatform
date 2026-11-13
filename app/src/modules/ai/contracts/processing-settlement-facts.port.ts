import type { EntityManager } from 'typeorm';

import type { JobStatus } from '../enums/job-status.enum';
import type { DocumentProcessingLlmUsage } from './document-processing-result';

export const PROCESSING_SETTLEMENT_FACTS = Symbol('PROCESSING_SETTLEMENT_FACTS');

export interface ReadSettlementFactsInput {
  /** `course.documents.full_pipeline_job_id` == `ai.processing_jobs.id` of the FULL_PIPELINE job. */
  readonly jobId: string;
  /** Reserve time of the attempt: only results published after it belong to the attempt. */
  readonly nextAttemptReservedAt: Date | null;
  readonly ownerId: string;
  readonly processingAttempt: number;
  readonly reservedAt: Date;
}

/** Queue row of the FULL_PIPELINE job. It describes the LATEST attempt only (retries re-arm the same row). */
export interface SettlementJobFacts {
  /** Go queue attempts claimed so far; starts at `processingAttempt - 1`, so `< processingAttempt` means never claimed. */
  readonly attempts: number;
  readonly cancellationMarkerId: string | null;
  readonly cancelledAt: Date | null;
  readonly completedAt: Date | null;
  readonly platformModelId: string | null;
  /** NULL for rows enqueued before the Document attempt was recorded. */
  readonly processingAttempt: number | null;
  readonly probeResultId: string | null;
  readonly status: JobStatus;
  readonly updatedAt: Date;
}

export interface PublishedProcessingResultFacts {
  readonly createdAt: Date;
  readonly payload: Record<string, unknown>;
}

export interface ProcessingSettlementFacts {
  /** True when the Go job wrote a result that the return relay has not published yet; the relay will settle it. */
  readonly hasUnpublishedResult: boolean;
  readonly job: SettlementJobFacts | null;
  /** Provider usage rows of the attempt written by Go (`go-llm:*`), summed per model. */
  readonly llmRecords: {
    readonly unavailableCount: number;
    readonly usage: readonly DocumentProcessingLlmUsage[];
  };
  readonly latestPublishedResult: PublishedProcessingResultFacts | null;
  readonly revoked: boolean;
  /** Speech-to-text checkpoints of the job's probe result; they survive cancellation. */
  readonly stt: { readonly billedMs: number; readonly uncertainMs: number };
}

/**
 * AI-owned read of the facts a credit settlement needs, so the content context never queries `ai.*` itself.
 * It runs on the caller's transaction (one statement, one snapshot); it never writes.
 */
export interface ProcessingSettlementFactsPort {
  readSettlementFacts(manager: EntityManager, input: ReadSettlementFactsInput): Promise<ProcessingSettlementFacts>;
}
