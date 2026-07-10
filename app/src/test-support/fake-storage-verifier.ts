import {
  ObjectVerification,
  StorageVerifier,
} from '../storage/contracts/storage-verifier.port';

/**
 * Fake cho test: điều khiển kết quả verify mà không cần MinIO thật.
 * Mặc định: file tồn tại, size hợp lệ, magic bytes khớp.
 */
export class FakeStorageVerifier implements StorageVerifier {
  private result: ObjectVerification = {
    exists: true,
    sizeBytes: 1024,
    magicBytesValid: true,
  };

  setResult(partial: Partial<ObjectVerification>): void {
    this.result = { ...this.result, ...partial };
  }

  async verify(_objectKey: string, _documentType: string): Promise<ObjectVerification> {
    return this.result;
  }
}
