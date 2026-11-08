import { registerAs } from '@nestjs/config';

export default registerAs('creditReconciler', () => ({
  // Strict opt-ins: the reconciler is off, and when on it only reports until dry run is explicitly "false".
  enabled: process.env.CREDIT_RECONCILER_ENABLED === 'true',
  dryRun: process.env.CREDIT_RECONCILER_DRY_RUN !== 'false',
  intervalMs: parseInt(process.env.CREDIT_RECONCILER_INTERVAL_MS ?? '300000', 10),
  orphanGraceMs: parseInt(process.env.CREDIT_RECONCILER_ORPHAN_GRACE_MS ?? '1800000', 10),
  heldReleaseAfterMs: parseInt(process.env.CREDIT_RECONCILER_HELD_RELEASE_AFTER_MS ?? '86400000', 10),
  batchSize: parseInt(process.env.CREDIT_RECONCILER_BATCH_SIZE ?? '50', 10),
}));
