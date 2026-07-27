import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { createServer as createNetServer, Socket } from 'node:net';

import { ApplicationConfigService } from '../config/application-config.service';
import { WorkerHealthServer } from './worker-health-server.service';

const workerConfig = (port: number): ApplicationConfigService =>
  new ApplicationConfigService(new ConfigService({
    worker: {
      chunkInsertBatchSize: 500,
      chunkMaxChars: 1_500,
      chunkOverlapChars: 150,
      chunkTargetChars: 1_200,
      errorBackoffMs: 5_000,
      healthHost: '127.0.0.1',
      healthPort: port,
      jobBatchSize: 10,
      maxChunksPerDocument: 20_000,
      maxChunkTotalChars: 24_000_000,
      maxExtractableObjectBytes: 20_971_520,
      outboxBatchSize: 100,
      pollIntervalMs: 1_000,
      stuckJobBatchSize: 100,
      stuckJobTimeoutMs: 300_000,
    },
  }));

const reservePort = async (): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to reserve an IPv4 port for the worker health test'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });

describe('WorkerHealthServer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('starts a dedicated health listener and returns 200 only on /health', async () => {
    const port = await reservePort();
    const server = new WorkerHealthServer(workerConfig(port));

    await server.onApplicationBootstrap();

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    const rootResponse = await fetch(`http://127.0.0.1:${port}/`);

    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: 'ok' });
    expect(rootResponse.status).toBe(404);

    await server.onApplicationShutdown();
  });

  it('fails worker bootstrap when the dedicated health port cannot be bound', async () => {
    const port = await reservePort();
    const blocker = createNetServer();

    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(port, '127.0.0.1', () => resolve());
    });

    const server = new WorkerHealthServer(workerConfig(port));

    await expect(server.onApplicationBootstrap()).rejects.toThrow();

    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('forces open sockets closed after the bounded shutdown timeout', async () => {
    jest.useFakeTimers();
    const port = await reservePort();
    const server = new WorkerHealthServer(workerConfig(port));

    await server.onApplicationBootstrap();

    const socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(port, '127.0.0.1', () => resolve());
    });
    const socketClosed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
    });

    const shutdownPromise = server.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(5_000);
    await Promise.all([shutdownPromise, socketClosed]);

    expect(socket.destroyed).toBe(true);
  });
});
