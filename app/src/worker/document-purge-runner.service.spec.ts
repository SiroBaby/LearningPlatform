import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../config/application-config.service';
import { DocumentPurgeStorageError } from '../modules/content/contracts/document-purge-storage.port';
import type { DocumentPurgeService } from '../modules/content/document-purge.service';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { DocumentPurgeRunner } from './document-purge-runner.service';

function runnerFailingPreflightWith(error: unknown): DocumentPurgeRunner {
  const purge = {
    assertMediaBucketVersioned: jest.fn(async (): Promise<void> => {
      throw error;
    }),
  } as unknown as DocumentPurgeService;
  return new DocumentPurgeRunner({} as ApplicationConfigService, purge);
}

describe('DocumentPurgeRunner preflight', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.MEDIA_BUCKET_NOT_VERSIONED), 'PURGE_MEDIA_BUCKET_NOT_VERSIONED'],
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.ACCESS_DENIED), 'PURGE_ACCESS_DENIED'],
    [new DocumentPurgeStorageError(DocumentPurgeErrorCode.STORAGE_TEMPORARY), 'PURGE_STORAGE_TEMPORARY'],
    [new Error('raw secret-bearing message s3://bucket/key'), 'PURGE_PREFLIGHT_UNCLASSIFIED'],
  ])('logs a stable reason code for %p without raw error details', async (error, expectedErrorCode) => {
    const logger = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);

    await expect(runnerFailingPreflightWith(error).onModuleInit()).rejects.toBe(error);

    expect(logger.mock.calls).toEqual([[{
      errorCode: expectedErrorCode,
      event: 'document.purge.preflight.failed',
      runtime: 'document-purge',
    }]]);
  });
});

const BACKLOG_INTERVAL_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;
const BACKLOG_STATEMENT_TIMEOUT_MS = 10_000;
const BACKLOG_READ_TIMEOUT_MS = 12_000;

describe('DocumentPurgeRunner backlog report', () => {
  const mockBacklog = { failedCount: 1, oldestPendingAgeSeconds: 4_200, pendingCount: 3 };

  function runnerWith(purge: Partial<DocumentPurgeService>): DocumentPurgeRunner {
    const config = {
      documentPurge: { backlogIntervalMs: BACKLOG_INTERVAL_MS, backoffBaseMs: POLL_INTERVAL_MS, pollIntervalMs: POLL_INTERVAL_MS },
    } as unknown as ApplicationConfigService;
    return new DocumentPurgeRunner(config, purge as DocumentPurgeService);
  }

  function countBacklogLogs(calls: readonly unknown[][]): number {
    return calls.filter(([message]) => (message as { event?: string }).event === 'document.purge.backlog').length;
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('logs the backlog at startup and on every interval with the exact fields', async () => {
    const mockLog = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const mockPurge = {
      purgeDueManifests: jest.fn(async (): Promise<number> => 0),
      readBacklog: jest.fn(async () => mockBacklog),
    };
    const runner = runnerWith(mockPurge);

    await runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BACKLOG_INTERVAL_MS);
    await runner.onApplicationShutdown();

    const actualBacklogLogs = mockLog.mock.calls.filter(([message]) =>
      (message as { event?: string }).event === 'document.purge.backlog');
    const expectedBacklogLog = { ...mockBacklog, event: 'document.purge.backlog', runtime: 'document-purge' };
    expect(actualBacklogLogs).toEqual([[expectedBacklogLog], [expectedBacklogLog]]);
  });

  it('keeps reporting while a purge cycle never finishes', async () => {
    const mockLog = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const mockPurge = {
      purgeDueManifests: jest.fn(() => new Promise<number>(() => undefined)),
      readBacklog: jest.fn(async () => mockBacklog),
    };
    const runner = runnerWith(mockPurge);

    void runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BACKLOG_INTERVAL_MS * 2);

    expect(countBacklogLogs(mockLog.mock.calls)).toBe(3);
  });

  it('logs a distinct event and keeps going when the backlog read fails', async () => {
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const mockError = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
    const mockReadBacklog = jest.fn(async () => mockBacklog)
      .mockRejectedValueOnce(new Error('connection to s3://secret failed'));
    const runner = runnerWith({
      purgeDueManifests: jest.fn(async (): Promise<number> => 0),
      readBacklog: mockReadBacklog,
    });

    await runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BACKLOG_INTERVAL_MS);
    await runner.onApplicationShutdown();

    expect(mockError.mock.calls).toEqual([[{ event: 'document.purge.backlog.failed', runtime: 'document-purge' }]]);
    expect(mockReadBacklog).toHaveBeenCalledTimes(2);
  });

  it('times out a hung backlog read, logs the failure and still shuts down', async () => {
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const mockError = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
    const mockReadBacklog = jest.fn((_timeoutMs: number) => new Promise<typeof mockBacklog>(() => undefined));
    const runner = runnerWith({
      purgeDueManifests: jest.fn(async (): Promise<number> => 0),
      readBacklog: mockReadBacklog,
    });

    await runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(BACKLOG_READ_TIMEOUT_MS);
    await runner.onApplicationShutdown();

    expect(mockError.mock.calls).toEqual([[{ event: 'document.purge.backlog.failed', runtime: 'document-purge' }]]);
    expect(mockReadBacklog).toHaveBeenCalledWith(BACKLOG_STATEMENT_TIMEOUT_MS);
  });

  it('stops reporting after shutdown', async () => {
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const mockReadBacklog = jest.fn(async () => mockBacklog);
    const runner = runnerWith({
      purgeDueManifests: jest.fn(async (): Promise<number> => 0),
      readBacklog: mockReadBacklog,
    });

    await runner.onApplicationBootstrap();
    await runner.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(BACKLOG_INTERVAL_MS * 3);

    expect(mockReadBacklog).toHaveBeenCalledTimes(1);
  });
});
