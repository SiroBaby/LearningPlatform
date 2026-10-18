import { registerAs } from '@nestjs/config';

export default registerAs('documentPurge', () => ({
  // Dedicated delete identity; never falls back to the API storage credentials.
  accessKey: process.env.OBJECT_STORAGE_PURGE_ACCESS_KEY,
  secretKey: process.env.OBJECT_STORAGE_PURGE_SECRET_KEY,
  batchSize: parseInt(process.env.DOCUMENT_PURGE_BATCH_SIZE ?? '10', 10),
  pollIntervalMs: parseInt(process.env.DOCUMENT_PURGE_POLL_INTERVAL_MS ?? '5000', 10),
  backlogIntervalMs: parseInt(process.env.DOCUMENT_PURGE_BACKLOG_INTERVAL_MS ?? '300000', 10),
  leaseMs: parseInt(process.env.DOCUMENT_PURGE_LEASE_MS ?? '300000', 10),
  maxAttempts: parseInt(process.env.DOCUMENT_PURGE_MAX_ATTEMPTS ?? '8', 10),
  backoffBaseMs: parseInt(process.env.DOCUMENT_PURGE_BACKOFF_BASE_MS ?? '30000', 10),
  backoffMaxMs: parseInt(process.env.DOCUMENT_PURGE_BACKOFF_MAX_MS ?? '3600000', 10),
  storageRequestTimeoutMs: parseInt(
    process.env.DOCUMENT_PURGE_STORAGE_REQUEST_TIMEOUT_MS ?? '10000',
    10,
  ),
}));
