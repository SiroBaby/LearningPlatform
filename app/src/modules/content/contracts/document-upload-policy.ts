import { BadRequestException } from '@nestjs/common';

import type { StorageBucketKind } from '../../../storage/contracts/storage-bucket.port';
import { DocumentType } from '../enums/document-type.enum';

export interface DocumentUploadPolicy {
  bucket: StorageBucketKind;
  contentType: string;
  extension: string;
  maxSizeBytes: number;
}

const MAX_DOCUMENT_SIZE_BYTES = 1024 * 1024 * 1024;
export const MAX_MP3_SIZE_BYTES = 300 * 1024 * 1024;
export const MAX_MP4_SIZE_BYTES = 500 * 1024 * 1024;

const POLICIES: Partial<Record<DocumentType, DocumentUploadPolicy>> = {
  [DocumentType.PDF]: {
    bucket: 'documents',
    contentType: 'application/pdf',
    extension: '.pdf',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
  },
  [DocumentType.TEXT]: {
    bucket: 'documents',
    contentType: 'text/plain',
    extension: '.txt',
    maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES,
  },
  [DocumentType.AUDIO]: {
    bucket: 'media',
    contentType: 'audio/mpeg',
    extension: '.mp3',
    maxSizeBytes: MAX_MP3_SIZE_BYTES,
  },
  [DocumentType.VIDEO]: {
    bucket: 'media',
    contentType: 'video/mp4',
    extension: '.mp4',
    maxSizeBytes: MAX_MP4_SIZE_BYTES,
  },
};

export function resolveDocumentUploadPolicy(
  type: DocumentType,
  originalName: string,
): DocumentUploadPolicy {
  const policy = getDocumentUploadPolicy(type);
  if (!originalName.toLowerCase().endsWith(policy.extension)) {
    throw new BadRequestException(
      `${type} documents must use the ${policy.extension} extension`,
    );
  }
  return policy;
}

export function getDocumentUploadPolicy(type: DocumentType): DocumentUploadPolicy {
  const policy = POLICIES[type];
  if (!policy) {
    throw new BadRequestException(`${type} uploads are not supported yet`);
  }
  return policy;
}

export function assertDocumentUploadSize(
  policy: DocumentUploadPolicy,
  sizeBytes: number,
): void {
  if (sizeBytes > policy.maxSizeBytes) {
    throw new BadRequestException(
      `${policy.extension.toUpperCase()} uploads must not exceed ${policy.maxSizeBytes} bytes`,
    );
  }
}
