import { registerAs } from '@nestjs/config';

export default registerAs('mediaOrphanScanner', () => ({
  // Both flags are strict opt-ins: the scanner is off, and when on it only reports.
  enabled: process.env.MEDIA_ORPHAN_SCANNER_ENABLED === 'true',
  deleteEnabled: process.env.MEDIA_ORPHAN_SCANNER_DELETE_ENABLED === 'true',
  intervalMs: parseInt(process.env.MEDIA_ORPHAN_SCANNER_INTERVAL_MS ?? '3600000', 10),
  minAgeMs: parseInt(process.env.MEDIA_ORPHAN_SCANNER_MIN_AGE_MS ?? '86400000', 10),
  pageSize: parseInt(process.env.MEDIA_ORPHAN_SCANNER_PAGE_SIZE ?? '500', 10),
  maxObjectsPerRun: parseInt(process.env.MEDIA_ORPHAN_SCANNER_MAX_OBJECTS_PER_RUN ?? '5000', 10),
  maxDeletesPerRun: parseInt(process.env.MEDIA_ORPHAN_SCANNER_MAX_DELETES_PER_RUN ?? '100', 10),
  deleteDelayMs: parseInt(process.env.MEDIA_ORPHAN_SCANNER_DELETE_DELAY_MS ?? '250', 10),
}));
