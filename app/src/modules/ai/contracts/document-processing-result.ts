export const DOCUMENT_PROCESSING_RESULT_EVENT = 'DocumentProcessingResult' as const;
export const DOCUMENT_PROCESSING_RESULT_VERSION = 1 as const;

export enum DocumentProcessingResultStatus {
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum DocumentProcessingFailureCode {
  EXTRACTION_OBJECT_NOT_FOUND = 'EXTRACTION_OBJECT_NOT_FOUND',
  EXTRACTION_OBJECT_TOO_LARGE = 'EXTRACTION_OBJECT_TOO_LARGE',
  PDF_INVALID = 'PDF_INVALID',
  PDF_TEXT_NOT_FOUND = 'PDF_TEXT_NOT_FOUND',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  PROCESSING_TIMED_OUT = 'PROCESSING_TIMED_OUT',
}

export interface DocumentProcessingResult {
  readonly documentId: string;
  readonly errorCode: DocumentProcessingFailureCode | null;
  readonly errorMessage: string | null;
  readonly ownerId: string;
  readonly status: DocumentProcessingResultStatus;
  readonly version: typeof DOCUMENT_PROCESSING_RESULT_VERSION;
}
