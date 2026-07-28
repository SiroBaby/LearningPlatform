export const DOCUMENT_PROCESSING_RESULT_EVENT = 'DocumentProcessingResult' as const;
export const DOCUMENT_PROCESSING_RESULT_VERSION = 1 as const;

export enum DocumentProcessingResultStatus {
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum DocumentProcessingFailureCode {
  CHUNK_RESOURCE_LIMIT_EXCEEDED = 'CHUNK_RESOURCE_LIMIT_EXCEEDED',
  BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
  EXTRACTION_OBJECT_NOT_FOUND = 'EXTRACTION_OBJECT_NOT_FOUND',
  EXTRACTION_OBJECT_TOO_LARGE = 'EXTRACTION_OBJECT_TOO_LARGE',
  GENERATION_OUTPUT_INVALID = 'GENERATION_OUTPUT_INVALID',
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
    errorCode === DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID ||
    errorCode === DocumentProcessingFailureCode.PROCESSING_TIMED_OUT ||
    errorCode === DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE;
}

export interface DocumentProcessingResult {
  readonly budgetStatus: string | null;
  readonly documentId: string;
  readonly estimatedCredits: number | null;
  readonly estimateStatus: string | null;
  readonly errorCode: DocumentProcessingFailureCode | null;
  readonly errorMessage: string | null;
  readonly ownerId: string;
  readonly settledCredits: number | null;
  readonly status: DocumentProcessingResultStatus;
  readonly version: typeof DOCUMENT_PROCESSING_RESULT_VERSION;
}
