import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import type { JobPoller } from '../modules/ai/job-poller.service';
import type { StuckJobDetector } from '../modules/ai/stuck-job-detector.service';
import type { ForwardRelay } from '../modules/content/forward-relay.service';
import type { ReturnRelay } from './return-relay.service';
import { WorkerRunner } from './worker-runner.service';

describe('WorkerRunner', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs the bounded production cycle in relay, processor, recovery, return order without successful cycle logs', async () => {
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const relay = { pump: jest.fn<ForwardRelay['pump']>().mockResolvedValue(undefined) };
    const poller = {
      tick: jest
        .fn<JobPoller['tick']>()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const stuckJobs = {
      detectAndFail: jest.fn<StuckJobDetector['detectAndFail']>().mockResolvedValue(0),
    };
    const returnRelay = {
      pump: jest.fn<ReturnRelay['pump']>().mockResolvedValue(undefined),
    };
    const config = {
      worker: {
        errorBackoffMs: 1,
        jobBatchSize: 3,
        outboxBatchSize: 5,
        pollIntervalMs: 1_000,
        stuckJobBatchSize: 7,
        stuckJobTimeoutMs: 8_000,
      },
    } as ApplicationConfigService;
    const runner = new WorkerRunner(
      config,
      relay as unknown as ForwardRelay,
      poller as unknown as JobPoller,
      returnRelay as unknown as ReturnRelay,
      stuckJobs as unknown as StuckJobDetector,
    );

    await runner.onApplicationBootstrap();
    await runner.onApplicationShutdown();

    expect(relay.pump).toHaveBeenCalledWith(5);
    expect(poller.tick).toHaveBeenCalledTimes(2);
    expect(stuckJobs.detectAndFail).toHaveBeenCalledWith(8_000, 7);
    expect(returnRelay.pump).toHaveBeenCalledWith(5);
    expect(relay.pump.mock.invocationCallOrder[0]).toBeLessThan(
      poller.tick.mock.invocationCallOrder[0],
    );
    expect(stuckJobs.detectAndFail.mock.invocationCallOrder[0]).toBeLessThan(
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
    const config = {
      worker: {
        errorBackoffMs: 1,
        jobBatchSize: 3,
        outboxBatchSize: 5,
        pollIntervalMs: 1_000,
        stuckJobBatchSize: 7,
        stuckJobTimeoutMs: 8_000,
      },
    } as ApplicationConfigService;
    const runner = new WorkerRunner(
      config,
      { pump: async () => undefined } as unknown as ForwardRelay,
      { tick: async () => false } as unknown as JobPoller,
      { pump: async () => undefined } as unknown as ReturnRelay,
      { detectAndFail: async () => 0 } as unknown as StuckJobDetector,
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
    const config = {
      worker: {
        errorBackoffMs: 1,
        jobBatchSize: 1,
        outboxBatchSize: 1,
        pollIntervalMs: 1_000,
        stuckJobBatchSize: 1,
        stuckJobTimeoutMs: 1,
      },
    } as ApplicationConfigService;
    const runner = new WorkerRunner(
      config,
      { pump: async () => { throw new Error('raw document: secret lecture text'); } } as unknown as ForwardRelay,
      { tick: async () => false } as unknown as JobPoller,
      { pump: async () => undefined } as unknown as ReturnRelay,
      { detectAndFail: async () => 0 } as unknown as StuckJobDetector,
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
