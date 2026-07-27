import { describe, expect, it } from '@jest/globals';

import { DocumentType } from '../enums/document-type.enum';
import { resolveDocumentUploadPolicy } from './document-upload-policy';

describe('resolveDocumentUploadPolicy', () => {
  it('returns the exact storage policy for a supported document type', () => {
    expect(resolveDocumentUploadPolicy(DocumentType.PDF, 'lecture.PDF')).toEqual({
      contentType: 'application/pdf',
      extension: '.pdf',
    });
  });

  it('rejects a filename whose extension conflicts with declared type', () => {
    expect(() => resolveDocumentUploadPolicy(DocumentType.PDF, 'payload.txt')).toThrow(
      'PDF documents must use the .pdf extension',
    );
  });
});
