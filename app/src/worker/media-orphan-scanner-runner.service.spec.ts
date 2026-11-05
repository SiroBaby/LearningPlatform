import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import type { MediaOrphanScannerService } from '../modules/content/media-orphan-scanner.service';
import { MediaOrphanScannerRunner } from './media-orphan-scanner-runner.service';

const INTERVAL_MS = 60_000;

describe('MediaOrphanScannerRunner', () => {
  const scanOnce = jest.fn<MediaOrphanScannerService['scanOnce']>();

  function runnerFor(enabled: boolean): MediaOrphanScannerRunner {
    return new MediaOrphanScannerRunner(
      { mediaOrphanScanner: { deleteEnabled: false, enabled, intervalMs: INTERVAL_MS } } as unknown as ApplicationConfigService,
      { scanOnce } as unknown as MediaOrphanScannerService,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    scanOnce.mockReset();
    scanOnce.mockResolvedValue({} as Awaited<ReturnType<MediaOrphanScannerService['scanOnce']>>);
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

    expect(scanOnce).not.toHaveBeenCalled();
  });

  it('backs off after consecutive failed scans and resets after a success', async () => {
    const runner = runnerFor(true);
    scanOnce.mockResolvedValue({ outcome: 'FAILED' } as Awaited<ReturnType<MediaOrphanScannerService['scanOnce']>>);

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(scanOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanOnce).toHaveBeenCalledTimes(2);
    scanOnce.mockResolvedValue({ outcome: 'COMPLETED' } as Awaited<ReturnType<MediaOrphanScannerService['scanOnce']>>);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 4);
    expect(scanOnce).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanOnce).toHaveBeenCalledTimes(4);

    await runner.onApplicationShutdown();
  });

  it('scans at once, then once per interval, and stops on shutdown', async () => {
    const runner = runnerFor(true);

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(scanOnce).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(scanOnce).toHaveBeenCalledTimes(2);

    await runner.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(scanOnce).toHaveBeenCalledTimes(2);
    // Both scans receive the shutdown signal, which is aborted only now.
    expect(scanOnce.mock.calls[0][0]).toBe(scanOnce.mock.calls[1][0]);
    expect(scanOnce.mock.calls[1][0]?.aborted).toBe(true);
  });
});
