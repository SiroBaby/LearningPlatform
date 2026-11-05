import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';
import mediaOrphanScannerConfig from './media-orphan-scanner.config';

function scannerConfig(overrides: Record<string, unknown> = {}): ApplicationConfigService {
  return new ApplicationConfigService(new ConfigService({
    mediaOrphanScanner: {
      deleteDelayMs: 250,
      deleteEnabled: false,
      enabled: true,
      intervalMs: 3_600_000,
      maxDeletesPerRun: 100,
      maxObjectsPerRun: 5_000,
      minAgeMs: 86_400_000,
      pageSize: 500,
      ...overrides,
    },
  }));
}

describe('ApplicationConfigService.mediaOrphanScanner', () => {
  it('returns typed settings', () => {
    expect(scannerConfig({}).mediaOrphanScanner).toEqual({
      deleteDelayMs: 250,
      deleteEnabled: false,
      enabled: true,
      intervalMs: 3_600_000,
      maxDeletesPerRun: 100,
      maxObjectsPerRun: 5_000,
      minAgeMs: 86_400_000,
      pageSize: 500,
    });
  });

  it('ignores malformed tuning while the scanner is disabled so it cannot crash the purge worker', () => {
    const settings = scannerConfig({
      enabled: false, minAgeMs: Number.NaN, pageSize: -5, intervalMs: 'abc',
    }).mediaOrphanScanner;

    expect(settings).toMatchObject({ deleteEnabled: false, enabled: false });
  });

  it('allows an immediate delete delay of zero', () => {
    expect(scannerConfig({ deleteDelayMs: 0 }).mediaOrphanScanner.deleteDelayMs).toBe(0);
  });

  it.each([
    ['delete without the scanner', { deleteEnabled: true, enabled: false }, 'MEDIA_ORPHAN_SCANNER_DELETE_ENABLED requires MEDIA_ORPHAN_SCANNER_ENABLED'],
    ['non-boolean flag', { enabled: 'true' }, 'must be booleans'],
    ['minimum age below the floor', { minAgeMs: 3_600_000 }, 'MEDIA_ORPHAN_SCANNER_MIN_AGE_MS must be at least 21600000'],
    ['page size above the S3 limit', { pageSize: 1_001 }, 'MEDIA_ORPHAN_SCANNER_PAGE_SIZE must not exceed 1000'],
    ['object budget below one page', { maxObjectsPerRun: 100 }, 'MAX_OBJECTS_PER_RUN must be at least'],
    ['zero delete cap', { maxDeletesPerRun: 0 }, 'maxDeletesPerRun must be a positive integer'],
    ['negative delete delay', { deleteDelayMs: -1 }, 'deleteDelayMs must be a non-negative integer'],
    ['NaN interval', { intervalMs: Number.NaN }, 'intervalMs must be a positive integer'],
  ])('fails fast on %s', (_name, overrides, message) => {
    expect(() => scannerConfig(overrides).mediaOrphanScanner).toThrow(message);
  });
});

describe('media orphan scanner environment defaults', () => {
  it('is disabled and report-only unless both flags are exactly "true"', () => {
    const keys = [
      'MEDIA_ORPHAN_SCANNER_ENABLED',
      'MEDIA_ORPHAN_SCANNER_DELETE_ENABLED',
    ] as const;
    const previous = keys.map((key) => process.env[key]);
    try {
      for (const key of keys) delete process.env[key];
      expect(mediaOrphanScannerConfig()).toMatchObject({
        deleteEnabled: false, enabled: false, minAgeMs: 86_400_000,
      });
      process.env.MEDIA_ORPHAN_SCANNER_ENABLED = 'TRUE';
      process.env.MEDIA_ORPHAN_SCANNER_DELETE_ENABLED = '1';
      expect(mediaOrphanScannerConfig()).toMatchObject({ deleteEnabled: false, enabled: false });
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    }
  });
});
