import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';
import creditReconcilerConfig from './credit-reconciler.config';

function reconcilerConfig(overrides: Record<string, unknown> = {}): ApplicationConfigService {
  return new ApplicationConfigService(new ConfigService({
    creditReconciler: {
      batchSize: 50,
      dryRun: true,
      enabled: true,
      heldReleaseAfterMs: 86_400_000,
      intervalMs: 300_000,
      orphanGraceMs: 1_800_000,
      ...overrides,
    },
  }));
}

describe('ApplicationConfigService.creditReconciler', () => {
  it('returns typed settings', () => {
    const actualSettings = reconcilerConfig().creditReconciler;

    expect(actualSettings).toEqual({
      batchSize: 50,
      dryRun: true,
      enabled: true,
      heldReleaseAfterMs: 86_400_000,
      intervalMs: 300_000,
      orphanGraceMs: 1_800_000,
    });
  });

  it('ignores malformed tuning while disabled so it cannot crash the worker', () => {
    const actualSettings = reconcilerConfig({
      batchSize: -1, enabled: false, intervalMs: 'abc', orphanGraceMs: Number.NaN,
    }).creditReconciler;

    expect(actualSettings).toMatchObject({ dryRun: true, enabled: false });
  });

  it.each([
    ['non-boolean flag', { enabled: 'true' }, 'must be booleans'],
    ['non-boolean dry run', { dryRun: 'false' }, 'must be booleans'],
    ['orphan grace below the floor', { orphanGraceMs: 899_999 }, 'CREDIT_RECONCILER_ORPHAN_GRACE_MS must be at least 900000'],
    ['hold release below the floor', { heldReleaseAfterMs: 3_599_999 }, 'CREDIT_RECONCILER_HELD_RELEASE_AFTER_MS must be at least 3600000'],
    ['zero batch', { batchSize: 0 }, 'batchSize must be a positive integer'],
    ['NaN interval', { intervalMs: Number.NaN }, 'intervalMs must be a positive integer'],
  ])('fails fast on %s', (_name, overrides, message) => {
    expect(() => reconcilerConfig(overrides).creditReconciler).toThrow(message);
  });
});

describe('credit reconciler environment defaults', () => {
  const keys = [
    'CREDIT_RECONCILER_ENABLED',
    'CREDIT_RECONCILER_DRY_RUN',
    'CREDIT_RECONCILER_INTERVAL_MS',
    'CREDIT_RECONCILER_ORPHAN_GRACE_MS',
    'CREDIT_RECONCILER_HELD_RELEASE_AFTER_MS',
    'CREDIT_RECONCILER_BATCH_SIZE',
  ] as const;

  function withEnvironment(values: Partial<Record<(typeof keys)[number], string>>, run: () => void): void {
    const previous = keys.map((key) => process.env[key]);
    try {
      for (const key of keys) delete process.env[key];
      Object.assign(process.env, values);
      run();
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    }
  }

  it('is off and dry-run with the owner-approved defaults when nothing is set', () => {
    withEnvironment({}, () => {
      expect(creditReconcilerConfig()).toEqual({
        batchSize: 50,
        dryRun: true,
        enabled: false,
        heldReleaseAfterMs: 86_400_000,
        intervalMs: 300_000,
        orphanGraceMs: 1_800_000,
      });
    });
  });

  it('enables only on exactly "true" and applies only on exactly "false"', () => {
    withEnvironment({ CREDIT_RECONCILER_ENABLED: 'TRUE', CREDIT_RECONCILER_DRY_RUN: '0' }, () => {
      expect(creditReconcilerConfig()).toMatchObject({ dryRun: true, enabled: false });
    });
    withEnvironment({ CREDIT_RECONCILER_ENABLED: 'true', CREDIT_RECONCILER_DRY_RUN: 'false' }, () => {
      expect(creditReconcilerConfig()).toMatchObject({ dryRun: false, enabled: true });
    });
  });
});
