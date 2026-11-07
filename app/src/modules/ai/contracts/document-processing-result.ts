import type { CitationLocator } from '../../assessment/contracts/quiz-generation-handoff.contract';

export const DOCUMENT_PROCESSING_RESULT_EVENT = 'DocumentProcessingResult' as const;
export const DOCUMENT_PROCESSING_RESULT_VERSION = 1 as const;

/** ai.outbox event: Go measured the extracted text of a TEXT_EXTRACT job and the Node reservation may proceed (ADR-0033). */
export const DOCUMENT_EXTRACTION_COMPLETED_EVENT = 'DocumentExtractionCompleted' as const;

export enum DocumentProcessingResultStatus {
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum DocumentProcessingFailureCode {
  CHUNK_RESOURCE_LIMIT_EXCEEDED = 'CHUNK_RESOURCE_LIMIT_EXCEEDED',
  BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
  INSUFFICIENT_CREDITS_AFTER_EXTRACT = 'INSUFFICIENT_CREDITS_AFTER_EXTRACT',
  MEDIA_PRICING_UNAVAILABLE = 'MEDIA_PRICING_UNAVAILABLE',
  MEDIA_REQUIRES_PLATFORM_MODEL = 'MEDIA_REQUIRES_PLATFORM_MODEL',
  MEDIA_AUDIO_NOT_PREPARED = 'MEDIA_AUDIO_NOT_PREPARED',
  MEDIA_TRANSCRIPT_EMPTY = 'MEDIA_TRANSCRIPT_EMPTY',
  TRANSCRIPTION_OUTPUT_INVALID = 'TRANSCRIPTION_OUTPUT_INVALID',
  PROVIDER_INCOMPATIBLE = 'PROVIDER_INCOMPATIBLE',
  MEDIA_PROBE_FAILED = 'MEDIA_PROBE_FAILED',
  MEDIA_PROBE_STORAGE_TEMPORARY = 'MEDIA_PROBE_STORAGE_TEMPORARY',
  MEDIA_PROBE_TIMEOUT = 'MEDIA_PROBE_TIMEOUT',
  MEDIA_PROBE_OUTPUT_CAP_EXCEEDED = 'MEDIA_PROBE_OUTPUT_CAP_EXCEEDED',
  MEDIA_UNSUPPORTED_CONTAINER = 'MEDIA_UNSUPPORTED_CONTAINER',
  MEDIA_UNSUPPORTED_VIDEO_CODEC = 'MEDIA_UNSUPPORTED_VIDEO_CODEC',
  MEDIA_UNSUPPORTED_AUDIO_CODEC = 'MEDIA_UNSUPPORTED_AUDIO_CODEC',
  MEDIA_AUDIO_PREP_FAILED = 'MEDIA_AUDIO_PREP_FAILED',
  MEDIA_AUDIO_TRACK_REQUIRED = 'MEDIA_AUDIO_TRACK_REQUIRED',
  MEDIA_DURATION_EXCEEDED = 'MEDIA_DURATION_EXCEEDED',
  MEDIA_DURATION_MISMATCH = 'MEDIA_DURATION_MISMATCH',
  MEDIA_OBJECT_TOO_LARGE = 'MEDIA_OBJECT_TOO_LARGE',
  EXTRACTION_OBJECT_NOT_FOUND = 'EXTRACTION_OBJECT_NOT_FOUND',
  EXTRACTION_OBJECT_TOO_LARGE = 'EXTRACTION_OBJECT_TOO_LARGE',
  GENERATION_OUTPUT_INVALID = 'GENERATION_OUTPUT_INVALID',
  GENERATION_OUTPUT_TRUNCATED = 'GENERATION_OUTPUT_TRUNCATED',
  INSUFFICIENT_VALID_QUESTIONS = 'INSUFFICIENT_VALID_QUESTIONS',
  PDF_INVALID = 'PDF_INVALID',
  PDF_TEXT_NOT_FOUND = 'PDF_TEXT_NOT_FOUND',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  PROCESSING_TIMED_OUT = 'PROCESSING_TIMED_OUT',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
}

export function isDocumentProcessingFailureRetryable(
  errorCode: DocumentProcessingFailureCode | null,
): boolean {
  return errorCode === DocumentProcessingFailureCode.BUDGET_EXHAUSTED ||
    errorCode === DocumentProcessingFailureCode.INSUFFICIENT_CREDITS_AFTER_EXTRACT ||
    errorCode === DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID ||
    errorCode === DocumentProcessingFailureCode.GENERATION_OUTPUT_TRUNCATED ||
    errorCode === DocumentProcessingFailureCode.MEDIA_PROBE_STORAGE_TEMPORARY ||
    errorCode === DocumentProcessingFailureCode.MEDIA_PROBE_TIMEOUT ||
    errorCode === DocumentProcessingFailureCode.PROCESSING_TIMED_OUT ||
    errorCode === DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE;
}

/**
 * Failure codes that Go can only raise before any billable provider call (storage, extraction, chunking or policy
 * guards). A FAILED result with one of these codes spent nothing, so its reservation is released in full even when
 * the payload carries no usage block.
 */
const PRE_DISPATCH_FAILURE_CODES: ReadonlySet<DocumentProcessingFailureCode> = new Set([
  DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED,
  DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND,
  DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE,
  DocumentProcessingFailureCode.MEDIA_REQUIRES_PLATFORM_MODEL,
  DocumentProcessingFailureCode.MEDIA_AUDIO_NOT_PREPARED,
  DocumentProcessingFailureCode.PDF_INVALID,
  DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND,
]);

export function isFailureBeforeProviderDispatch(errorCode: DocumentProcessingFailureCode | null): boolean {
  return errorCode !== null && PRE_DISPATCH_FAILURE_CODES.has(errorCode);
}

/** Token usage of one LLM model reported by the Go worker. */
export interface DocumentProcessingLlmUsage {
  readonly inputTokens: number;
  readonly model: string;
  readonly outputTokens: number;
}

/**
 * Optional actual-usage block of the return payload (version stays 1; older payloads omit it).
 * Go sends it on every terminal result of the attempt that finished the job.
 */
export interface DocumentProcessingUsage {
  readonly llm: readonly DocumentProcessingLlmUsage[];
  /** Provider calls sent without receiving any answer or token count: the spend is unknown (ADR-0022 HELD). */
  readonly uncertainDispatches: number;
  /** Speech-to-text seconds with a complete transcript. Absent for documents without speech-to-text. */
  readonly sttBilledSeconds: number | null;
  /** Speech-to-text seconds sent without a known outcome. Absent for documents without speech-to-text. */
  readonly sttUncertainSeconds: number | null;
}

export interface DocumentProcessingResult {
  readonly attempt: number | null;
  readonly budgetStatus: string | null;
  readonly documentId: string;
  readonly estimatedCredits: number | null;
  readonly estimateStatus: string | null;
  readonly errorCode: DocumentProcessingFailureCode | null;
  readonly errorMessage: string | null;
  /** Set by Go only for TEXT_EXTRACT results (ADR-0033); such a job never has a reservation to settle. */
  readonly jobType?: string | null;
  readonly leaseId: string | null;
  readonly ownerId: string;
  readonly questions: readonly DocumentProcessingQuestion[] | null;
  readonly settledCredits: number | null;
  readonly status: DocumentProcessingResultStatus;
  readonly usage: DocumentProcessingUsage | null;
  readonly version: typeof DOCUMENT_PROCESSING_RESULT_VERSION;
}

export interface DocumentProcessingQuestion {
  readonly chunkId: string;
  readonly chunkIndex: number;
  readonly citation: { readonly chunkId: string; readonly locator: CitationLocator; readonly snippet: string };
  readonly explanation: string;
  readonly options: readonly { readonly content: string; readonly isCorrect: boolean }[];
  readonly ordinal: number;
  readonly stem: string;
}
