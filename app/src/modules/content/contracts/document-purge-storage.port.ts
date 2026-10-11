import type { BucketVersioningState } from '../enums/bucket-versioning-state.enum';
import { DocumentPurgeErrorCode } from '../enums/document-purge-error-code.enum';

export const DOCUMENT_PURGE_STORAGE = Symbol('DOCUMENT_PURGE_STORAGE');

export interface PurgeObjectVersion {
  readonly bucket: string;
  readonly key: string;
  readonly versionId: string;
}

export interface PurgeObject {
  readonly bucket: string;
  readonly key: string;
}

/**
 * Physical delete capability used only by the document purge worker. A
 * missing object or version counts as already deleted.
 */
export interface DocumentPurgeStorage {
  deleteObjectVersion(target: PurgeObjectVersion): Promise<void>;
  /** Only valid on a bucket whose versioning was never enabled. */
  deleteObject(target: PurgeObject): Promise<void>;
  getBucketVersioning(bucket: string): Promise<BucketVersioningState>;
}

/** Storage failure already classified into a stable code by the adapter. */
export class DocumentPurgeStorageError extends Error {
  constructor(
    readonly code: DocumentPurgeErrorCode,
    message = `Document purge storage failed: ${code}`,
  ) {
    super(message);
    this.name = DocumentPurgeStorageError.name;
  }
}
