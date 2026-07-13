import { Injectable } from '@nestjs/common';
import { isUtf8 } from 'buffer';

import { StorageService } from './storage.service';
import {
  ObjectVerification,
  StorageVerifier,
} from './contracts/storage-verifier.port';

// Magic bytes theo loại (docs/07: không tin Content-Type client gửi).
const MAGIC: Record<string, Buffer[]> = {
  PDF: [Buffer.from('%PDF')],
    TEXT: [],
};

@Injectable()
export class MinioStorageVerifier implements StorageVerifier {
  constructor(private readonly storage: StorageService) {}

  async verify(
    objectKey: string,
    documentType: string,
  ): Promise<ObjectVerification> {
    let sizeBytes = 0;
    try {
      const stat = await this.storage.statObject(objectKey);
      sizeBytes = stat.size;
    } catch {
      return { exists: false, sizeBytes: 0, magicBytesValid: false };
    }

    const magicBytesValid = await this.checkMagic(objectKey, documentType);
    return { exists: true, sizeBytes, magicBytesValid };
  }

  private async checkMagic(
    objectKey: string,
    documentType: string,
  ): Promise<boolean> {
    const signatures = MAGIC[documentType];
    if (!signatures) return false;

    const head = await this.storage.readHead(objectKey, 4096);
    if (documentType === 'TEXT') {
      return isUtf8(head) && !head.includes(0);
    }
    return signatures.some((sig) => head.subarray(0, sig.length).equals(sig));
  }
}
