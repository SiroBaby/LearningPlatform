import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import type { CreditReconcilerService } from '../modules/content/credit-reconciler.service';
import { CreditReconcilerRunner } from './credit-reconciler-runner.service';

const INTERVAL_MS = 60_000;

describe('CreditReconcilerRunner', () => {
  const reconcileOnce = jest.fn<CreditReconcilerService['reconcileOnce']>();

  function runnerFor(enabled: boolean): CreditReconcilerRunner {
    return new CreditReconcilerRunner(
      { creditReconciler: { dryRun: false, enabled, intervalMs: INTERVAL_MS } } as unknown as ApplicationConfigService,
      { reconcileOnce } as unknown as CreditReconcilerService,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    reconcileOnce.mockReset();
    reconcileOnce.mockResolvedValue({} as Awaited<ReturnType<CreditReconcilerService['reconcileOnce']>>);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does nothing while the flag is off', async () => {
    const runner = runnerFor(false);

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    await runner.onApplicationShutdown();

    expect(reconcileOnce).not.toHaveBeenCalled();
  });

  it('logs the enabled mode and the disabled state at bootstrap', () => {
    const log = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);

    runnerFor(false).onApplicationBootstrap();

    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'credit.reconcile.disabled' }));
  });

  it('backs off after consecutive failed scans and resets after a success', async () => {
    const runner = runnerFor(true);
    reconcileOnce.mockResolvedValue({ outcome: 'FAILED' } as Awaited<ReturnType<CreditReconcilerService['reconcileOnce']>>);

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileOnce).toHaveBeenCalledTimes(2);
    reconcileOnce.mockResolvedValue({ outcome: 'COMPLETED' } as Awaited<ReturnType<CreditReconcilerService['reconcileOnce']>>);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    expect(reconcileOnce).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileOnce).toHaveBeenCalledTimes(4);

    await runner.onApplicationShutdown();
  });

  it('scans at once, then once per interval, and stops on shutdown', async () => {
    const runner = runnerFor(true);

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(reconcileOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(reconcileOnce).toHaveBeenCalledTimes(2);

    await runner.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(reconcileOnce).toHaveBeenCalledTimes(2);
    // Both scans receive the shutdown signal, which is aborted only now.
    expect(reconcileOnce.mock.calls[0][0]).toBe(reconcileOnce.mock.calls[1][0]);
    expect(reconcileOnce.mock.calls[1][0]?.aborted).toBe(true);
  });
});
