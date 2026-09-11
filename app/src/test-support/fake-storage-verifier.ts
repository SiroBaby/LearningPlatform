import {
  ObjectVerification,
  StorageVerifier,
} from '../storage/contracts/storage-verifier.port';
import type { StorageBucketKind } from '../storage/contracts/storage-bucket.port';

/**
 * Fake cho test: điều khiển kết quả verify mà không cần MinIO thật.
 * Mặc định: file tồn tại, size hợp lệ, magic bytes khớp.
 */
export class FakeStorageVerifier implements StorageVerifier {
  private result: ObjectVerification = {
    contentValidation: 'VALID',
    exists: true,
    sizeBytes: 1024,
    versionId: 'version-1',
    etag: 'etag-1',
    magicBytesValid: true,
  };

  lastBucketKind: StorageBucketKind | undefined;
  verifyCalls = 0;

  setResult(partial: Partial<ObjectVerification> & { readonly magicBytesValid?: boolean }): void {
    const contentValidation = partial.magicBytesValid === undefined
      ? partial.contentValidation
      : partial.magicBytesValid ? 'VALID' : 'INVALID';
    this.result = {
      ...this.result,
      ...partial,
      ...(contentValidation ? { contentValidation } : {}),
    };
  }

  async verify(
    _objectKey: string,
    _documentType: string,
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<ObjectVerification> {
    this.verifyCalls += 1;
    this.lastBucketKind = bucketKind;
    return this.result;
  }
}
