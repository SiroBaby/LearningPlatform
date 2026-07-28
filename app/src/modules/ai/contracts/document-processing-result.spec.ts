import { describe, expect, it } from '@jest/globals';

import {
  DocumentProcessingFailureCode,
  isDocumentProcessingFailureRetryable,
} from './document-processing-result';

describe('isDocumentProcessingFailureRetryable', () => {
  it.each([
    [DocumentProcessingFailureCode.BUDGET_EXHAUSTED, true],
    [DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED, false],
    [DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND, false],
    [DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE, false],
    [DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID, true],
    [DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS, false],
    [DocumentProcessingFailureCode.PDF_INVALID, false],
    [DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND, false],
    [DocumentProcessingFailureCode.PROCESSING_FAILED, false],
    [DocumentProcessingFailureCode.PROCESSING_TIMED_OUT, true],
    [DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE, true],
    [null, false],
  ] satisfies readonly (readonly [DocumentProcessingFailureCode | null, boolean])[])(
    'returns %s for %s',
    (errorCode, expectedRetryable) => {
      expect(isDocumentProcessingFailureRetryable(errorCode)).toBe(expectedRetryable);
    },
  );
});
