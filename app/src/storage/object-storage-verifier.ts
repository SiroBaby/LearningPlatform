import { Injectable } from '@nestjs/common';
import { isUtf8 } from 'buffer';

import type {
  ContentValidation,
  ObjectVerification,
  StorageVerifier,
} from './contracts/storage-verifier.port';
import type { StorageBucketKind } from './contracts/storage-bucket.port';
import { StorageService } from './storage.service';

const MAGIC: Record<string, Buffer[]> = {
  PDF: [Buffer.from('%PDF')],
  TEXT: [],
};

@Injectable()
export class ObjectStorageVerifier implements StorageVerifier {
  constructor(private readonly storage: StorageService) {}

  async verify(
    objectKey: string,
    documentType: string,
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<ObjectVerification> {
    let sizeBytes = 0;
    let versionId: string | undefined;
    try {
      const stat = await this.storage.statObject(objectKey, bucketKind);
      sizeBytes = stat.size;
      versionId = stat.versionId;
    } catch {
      return { contentValidation: 'INVALID', exists: false, sizeBytes: 0 };
    }

    if (bucketKind === 'media') {
      return {
        contentValidation: 'DEFERRED',
        exists: true,
        sizeBytes,
        ...(versionId ? { versionId } : {}),
      };
    }

    const magicBytesValid = await this.checkMagic(objectKey, documentType);
    const contentValidation: ContentValidation = magicBytesValid ? 'VALID' : 'INVALID';
    return {
      contentValidation,
      exists: true,
      sizeBytes,
      ...(versionId ? { versionId } : {}),
    };
  }

  private async checkMagic(
    objectKey: string,
    documentType: string,
  ): Promise<boolean> {
    const signatures = MAGIC[documentType];
    if (!signatures) return false;

    const head = await this.storage.readHead(objectKey, 4096, 'documents');
    if (documentType === 'TEXT') {
      return isUtf8(head) && !head.includes(0);
    }
    return signatures.some((sig) => head.subarray(0, sig.length).equals(sig));
  }
}
