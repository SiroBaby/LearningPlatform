import { afterEach, describe, expect, it, jest } from '@jest/globals';

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

  it('runs the bounded production cycle in relay, processor, recovery, return order', async () => {
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
  });
});
