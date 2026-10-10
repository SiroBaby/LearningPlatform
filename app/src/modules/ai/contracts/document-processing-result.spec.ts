import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

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
    [DocumentProcessingFailureCode.GENERATION_OUTPUT_TRUNCATED, true],
    [DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS, false],
    [DocumentProcessingFailureCode.MEDIA_PROBE_FAILED, false],
    [DocumentProcessingFailureCode.MEDIA_PROBE_STORAGE_TEMPORARY, true],
    [DocumentProcessingFailureCode.MEDIA_PROBE_TIMEOUT, true],
    [DocumentProcessingFailureCode.MEDIA_PROBE_OUTPUT_CAP_EXCEEDED, false],
    [DocumentProcessingFailureCode.MEDIA_OBJECT_TOO_LARGE, false],
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

describe('media probe failure contract', () => {
  it('matches every permanent failure code emitted by the Go worker', () => {
    const goTypes = readFileSync(
      join(__dirname, '../../../../../worker/internal/mediaprobe/types.go'),
      'utf8',
    );
    const goMediaCodes = Array.from(
      goTypes.matchAll(/Failure\w+\s+FailureCode\s*=\s*"([^"]+)"/g),
      (match) => match[1],
    ).filter((code) => code.startsWith('MEDIA_')).sort();
    const nestMediaCodes = Object.values(DocumentProcessingFailureCode)
      .filter((code) => code.startsWith('MEDIA_'))
      .sort();

    expect(goMediaCodes).toEqual(nestMediaCodes);
  });
});
