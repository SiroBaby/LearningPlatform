import { registerAs } from '@nestjs/config';

export default registerAs('worker', () => ({
  errorBackoffMs: parseInt(process.env.WORKER_ERROR_BACKOFF_MS ?? '5000', 10),
  maxExtractableObjectBytes: parseInt(
    process.env.WORKER_MAX_EXTRACTABLE_OBJECT_BYTES ?? '20971520',
    10,
  ),
  jobBatchSize: parseInt(process.env.WORKER_JOB_BATCH_SIZE ?? '10', 10),
  outboxBatchSize: parseInt(process.env.WORKER_OUTBOX_BATCH_SIZE ?? '100', 10),
  pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '1000', 10),
  stuckJobBatchSize: parseInt(process.env.WORKER_STUCK_JOB_BATCH_SIZE ?? '100', 10),
  stuckJobTimeoutMs: parseInt(process.env.WORKER_STUCK_JOB_TIMEOUT_MS ?? '300000', 10),
}));
