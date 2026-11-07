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
    [DocumentProcessingFailureCode.MEDIA_AUDIO_PREP_FAILED, false],
    [DocumentProcessingFailureCode.MEDIA_DURATION_EXCEEDED, false],
    [DocumentProcessingFailureCode.MEDIA_DURATION_MISMATCH, false],
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

const NON_PROBE_MEDIA_CODES: ReadonlySet<string> = new Set([
  DocumentProcessingFailureCode.MEDIA_PRICING_UNAVAILABLE,
  DocumentProcessingFailureCode.MEDIA_REQUIRES_PLATFORM_MODEL,
]);

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
      // Not emitted by the media probe: MEDIA_REQUIRES_PLATFORM_MODEL comes from the full-pipeline worker
      // (processing/types.go) and MEDIA_PRICING_UNAVAILABLE from the Node probe projection.
      .filter((code) => code.startsWith('MEDIA_') && !NON_PROBE_MEDIA_CODES.has(code))
      .sort();

    expect(goMediaCodes).toEqual(nestMediaCodes);
  });

  it('keeps the full-pipeline MEDIA_REQUIRES_PLATFORM_MODEL code identical in the Go worker', () => {
    const goTypes = readFileSync(join(__dirname, '../../../../../worker/internal/processing/types.go'), 'utf8');

    expect(goTypes).toContain(`"${DocumentProcessingFailureCode.MEDIA_REQUIRES_PLATFORM_MODEL}"`);
  });
});
