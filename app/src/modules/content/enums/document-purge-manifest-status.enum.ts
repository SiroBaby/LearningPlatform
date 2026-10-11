export enum DocumentPurgeManifestStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  /** Terminal: purge stopped and needs owner action. */
  DEAD_LETTER = 'DEAD_LETTER',
}
