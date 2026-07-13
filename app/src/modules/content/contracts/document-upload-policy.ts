import { BadRequestException } from '@nestjs/common';

import { DocumentType } from '../enums/document-type.enum';

export interface DocumentUploadPolicy {
  contentType: string;
  extension: string;
}

const POLICIES: Partial<Record<DocumentType, DocumentUploadPolicy>> = {
  [DocumentType.PDF]: { contentType: 'application/pdf', extension: '.pdf' },
  [DocumentType.TEXT]: { contentType: 'text/plain', extension: '.txt' },
};

export function resolveDocumentUploadPolicy(
  type: DocumentType,
  originalName: string,
): DocumentUploadPolicy {
  const policy = POLICIES[type];
  if (!policy) {
    throw new BadRequestException(`${type} uploads are not supported yet`);
  }
  if (!originalName.toLowerCase().endsWith(policy.extension)) {
    throw new BadRequestException(
      `${type} documents must use the ${policy.extension} extension`,
    );
  }
  return policy;
}
