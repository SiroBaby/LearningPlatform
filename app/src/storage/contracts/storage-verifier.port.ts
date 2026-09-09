import type { StorageBucketKind } from './storage-bucket.port';

export type ContentValidation = 'VALID' | 'INVALID' | 'DEFERRED';

export interface ObjectVerification {
  contentValidation: ContentValidation;
  exists: boolean;
  sizeBytes: number;
  /** Version returned by HeadObject; media confirmation requires it. */
  versionId?: string;
  /** Kept as a compatibility seam for existing test doubles during rollout. */
  magicBytesValid?: boolean;
}

export const STORAGE_VERIFIER = Symbol('STORAGE_VERIFIER');

export interface StorageVerifier {
  verify(
    objectKey: string,
    documentType: string,
    bucketKind?: StorageBucketKind,
  ): Promise<ObjectVerification>;
}
