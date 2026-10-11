/** Normalized `GetBucketVersioning` result. */
export enum BucketVersioningState {
  ENABLED = 'ENABLED',
  SUSPENDED = 'SUSPENDED',
  /** Versioning was never enabled: deleting by key removes the bytes. */
  UNVERSIONED = 'UNVERSIONED',
}
