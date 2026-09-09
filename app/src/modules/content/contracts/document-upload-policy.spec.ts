import { describe, expect, it } from '@jest/globals';

import { DocumentType } from '../enums/document-type.enum';
import {
  assertDocumentUploadSize,
  MAX_MP3_SIZE_BYTES,
  MAX_MP4_SIZE_BYTES,
  resolveDocumentUploadPolicy,
} from './document-upload-policy';

describe('resolveDocumentUploadPolicy', () => {
  it('returns the documents bucket policy for PDF', () => {
    expect(resolveDocumentUploadPolicy(DocumentType.PDF, 'lecture.PDF')).toEqual({
      bucket: 'documents',
      contentType: 'application/pdf',
      extension: '.pdf',
      maxSizeBytes: 1024 * 1024 * 1024,
    });
  });

  it.each([
    [DocumentType.AUDIO, 'lecture.mp3', 'media', 'audio/mpeg', '.mp3', MAX_MP3_SIZE_BYTES],
    [DocumentType.VIDEO, 'lecture.mp4', 'media', 'video/mp4', '.mp4', MAX_MP4_SIZE_BYTES],
  ] as const)('selects the media bucket and cap for %s', (type, name, bucket, contentType, extension, maxSizeBytes) => {
    expect(resolveDocumentUploadPolicy(type, name)).toEqual({
      bucket,
      contentType,
      extension,
      maxSizeBytes,
    });
  });

  it.each([
    [DocumentType.AUDIO, 'lecture.mp3', MAX_MP3_SIZE_BYTES],
    [DocumentType.VIDEO, 'lecture.mp4', MAX_MP4_SIZE_BYTES],
  ] as const)('rejects %s over its policy cap', (type, name, maxSizeBytes) => {
    const policy = resolveDocumentUploadPolicy(type, name);

    expect(() => assertDocumentUploadSize(policy, maxSizeBytes + 1)).toThrow(
      `${policy.extension.toUpperCase()} uploads must not exceed ${maxSizeBytes} bytes`,
    );
  });

  it('rejects a filename whose extension conflicts with declared type', () => {
    expect(() => resolveDocumentUploadPolicy(DocumentType.PDF, 'payload.txt')).toThrow(
      'PDF documents must use the .pdf extension',
    );
  });
});
