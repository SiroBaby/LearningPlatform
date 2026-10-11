/** Stable codes persisted in `last_error_code` and logged by the purge worker. */
export enum DocumentPurgeErrorCode {
  /** Throttling, 5xx, timeout or network failure; retried with capped backoff. */
  STORAGE_TEMPORARY = 'PURGE_STORAGE_TEMPORARY',
  /** The purge identity is not allowed to delete; dead-lettered immediately. */
  ACCESS_DENIED = 'PURGE_ACCESS_DENIED',
  /** Bucket, endpoint or request shape is wrong; dead-lettered immediately. */
  CONFIGURATION = 'PURGE_CONFIGURATION',
  /** Another live Document still points at the same bucket and key. */
  ACTIVE_REFERENCE = 'PURGE_ACTIVE_REFERENCE',
  /** Temporary failures or crashes used up every allowed attempt. */
  ATTEMPTS_EXHAUSTED = 'PURGE_ATTEMPTS_EXHAUSTED',
  /** A locator without VersionId points at a bucket that has versioning. */
  UNVERSIONED_LOCATOR = 'PURGE_UNVERSIONED_LOCATOR',
}
