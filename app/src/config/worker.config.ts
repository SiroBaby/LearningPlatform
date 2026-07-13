import { registerAs } from '@nestjs/config';

export default registerAs('worker', () => ({
  errorBackoffMs: parseInt(process.env.WORKER_ERROR_BACKOFF_MS ?? '5000', 10),
  jobBatchSize: parseInt(process.env.WORKER_JOB_BATCH_SIZE ?? '10', 10),
  outboxBatchSize: parseInt(process.env.WORKER_OUTBOX_BATCH_SIZE ?? '100', 10),
  pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '1000', 10),
}));
