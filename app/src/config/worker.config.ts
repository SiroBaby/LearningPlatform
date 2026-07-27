import { registerAs } from '@nestjs/config';

export default registerAs('worker', () => ({
  chunkInsertBatchSize: parseInt(process.env.WORKER_CHUNK_INSERT_BATCH_SIZE ?? '500', 10),
  chunkMaxChars: parseInt(process.env.WORKER_CHUNK_MAX_CHARS ?? '1500', 10),
  chunkOverlapChars: parseInt(process.env.WORKER_CHUNK_OVERLAP_CHARS ?? '150', 10),
  chunkTargetChars: parseInt(process.env.WORKER_CHUNK_TARGET_CHARS ?? '1200', 10),
  errorBackoffMs: parseInt(process.env.WORKER_ERROR_BACKOFF_MS ?? '5000', 10),
  healthHost: process.env.WORKER_HEALTH_HOST ?? '0.0.0.0',
  healthPort: parseInt(process.env.WORKER_HEALTH_PORT ?? '3403', 10),
  maxExtractableObjectBytes: parseInt(
    process.env.WORKER_MAX_EXTRACTABLE_OBJECT_BYTES ?? '20971520',
    10,
  ),
  maxChunksPerDocument: parseInt(process.env.WORKER_MAX_CHUNKS_PER_DOCUMENT ?? '20000', 10),
  maxChunkTotalChars: parseInt(process.env.WORKER_MAX_CHUNK_TOTAL_CHARS ?? '24000000', 10),
  jobBatchSize: parseInt(process.env.WORKER_JOB_BATCH_SIZE ?? '10', 10),
  outboxBatchSize: parseInt(process.env.WORKER_OUTBOX_BATCH_SIZE ?? '100', 10),
  pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '1000', 10),
  stuckJobBatchSize: parseInt(process.env.WORKER_STUCK_JOB_BATCH_SIZE ?? '100', 10),
  stuckJobTimeoutMs: parseInt(process.env.WORKER_STUCK_JOB_TIMEOUT_MS ?? '300000', 10),
}));
