export interface ObjectVerification {
  exists: boolean;
  sizeBytes: number;
  magicBytesValid: boolean;
}

export const STORAGE_VERIFIER = Symbol('STORAGE_VERIFIER');

export interface StorageVerifier {
  verify(objectKey: string, documentType: string): Promise<ObjectVerification>;
}
