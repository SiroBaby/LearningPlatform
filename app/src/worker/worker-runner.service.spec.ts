import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import type { ForwardRelay } from '../modules/content/forward-relay.service';
import type { ReturnRelay } from './return-relay.service';
import { WorkerRunner } from './worker-runner.service';

const workerConfig = (): ApplicationConfigService => ({
  worker: {
    errorBackoffMs: 1,
    outboxBatchSize: 5,
    pollIntervalMs: 1_000,
  },
} as ApplicationConfigService);

describe('WorkerRunner', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs forward and return relays in order without successful cycle logs', async () => {
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const relay = { pump: jest.fn<ForwardRelay['pump']>().mockResolvedValue(undefined) };
    const returnRelay = {
      pump: jest.fn<ReturnRelay['pump']>().mockResolvedValue(undefined),
    };
    const config = workerConfig();
    const runner = new WorkerRunner(
      config,
      relay as unknown as ForwardRelay,
      returnRelay as unknown as ReturnRelay,
    );

    await runner.onApplicationBootstrap();
    await runner.onApplicationShutdown();

    expect(relay.pump).toHaveBeenCalledWith(5);
    expect(returnRelay.pump).toHaveBeenCalledWith(5);
    expect(relay.pump.mock.invocationCallOrder[0]).toBeLessThan(
      returnRelay.pump.mock.invocationCallOrder[0],
    );
    expect(logger).toHaveBeenCalledWith({ event: 'worker.started', runtime: 'worker' });
    const cycleLogs = logger.mock.calls
      .map(([message]) => message)
      .filter((message): message is Record<string, unknown> =>
        typeof message === 'object' && message !== null && 'cycleId' in message,
      );
    expect(cycleLogs).toEqual([]);
    expect(logger).toHaveBeenCalledWith({ event: 'worker.shutdown.drain', runtime: 'worker' });
    expect(logger).toHaveBeenCalledWith({ event: 'worker.shutdown.completed', runtime: 'worker' });
  });

  it('keeps an idle polling cycle quiet', async () => {
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const config = workerConfig();
    const runner = new WorkerRunner(
      config,
      { pump: async () => undefined } as unknown as ForwardRelay,
      { pump: async () => undefined } as unknown as ReturnRelay,
    );

    await runner.onApplicationBootstrap();
    await runner.onApplicationShutdown();

    expect(logger.mock.calls).toEqual([
      [{ event: 'worker.started', runtime: 'worker' }],
      [{ event: 'worker.shutdown.drain', runtime: 'worker' }],
      [{ event: 'worker.shutdown.completed', runtime: 'worker' }],
    ]);
  });

  it('logs safe lifecycle events without the raw worker error payload', async () => {
    const logLogger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const errorLogger = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
    const warnLogger = jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);
    const config = workerConfig();
    const runner = new WorkerRunner(
      config,
      { pump: async () => { throw new Error('raw document: secret lecture text'); } } as unknown as ForwardRelay,
      { pump: async () => undefined } as unknown as ReturnRelay,
    );

    await runner.onApplicationBootstrap();
    await runner.onApplicationShutdown();

    expect(errorLogger).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'worker.cycle.failed', runtime: 'worker' }),
    );
    expect(warnLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        delayMs: 1,
        event: 'worker.cycle.backoff',
        runtime: 'worker',
      }),
    );
    const failedCycleId = errorLogger.mock.calls[0]?.[0].cycleId;
    expect(failedCycleId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(warnLogger.mock.calls[0]?.[0].cycleId).toBe(failedCycleId);
    expect(logLogger.mock.calls).toEqual([
      [{ event: 'worker.started', runtime: 'worker' }],
      [{ event: 'worker.shutdown.drain', runtime: 'worker' }],
      [{ event: 'worker.shutdown.completed', runtime: 'worker' }],
    ]);
    expect(JSON.stringify([...logLogger.mock.calls, ...errorLogger.mock.calls, ...warnLogger.mock.calls])).not.toContain(
      'secret lecture text',
    );
  });
});
