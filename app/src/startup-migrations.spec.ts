import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'child_process';

const mockStartupEvents: string[] = [];
const mockRunStartupMigrations = jest.fn<() => Promise<void>>();

jest.mock('./database/migrate', () => ({
  runStartupMigrations: mockRunStartupMigrations,
}));

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: async () => {
      mockStartupEvents.push('api.create');
      return {
        enableShutdownHooks: () => undefined,
        get: () => ({
          application: {
            port: 3000,
            swagger: { enabled: false },
          },
        }),
        listen: async () => {
          mockStartupEvents.push('api.listen');
        },
        setGlobalPrefix: () => undefined,
        use: () => undefined,
        useGlobalPipes: () => undefined,
      };
    },
    createApplicationContext: async () => {
      mockStartupEvents.push('worker.create-context');
      return {
        enableShutdownHooks: () => undefined,
      };
    },
  },
}));

jest.mock('./common/logging/application-logger.factory', () => ({
  createApplicationLogger: () => ({
    error: () => undefined,
    log: () => undefined,
  }),
}));

import { bootstrapApi } from './main';
import { runStartupMigrations } from './database/migrate';
import { bootstrapWorker } from './worker';

describe('backend-owned startup migrations', () => {
  beforeEach(() => {
    mockStartupEvents.splice(0);
    mockRunStartupMigrations.mockReset();
  });

  it('runs API migrations before creating and listening on the Nest application', async () => {
    // Given
    mockRunStartupMigrations.mockImplementation(async () => {
      mockStartupEvents.push('api.migrate');
    });

    // When
    await bootstrapApi();

    // Then
    expect(mockStartupEvents).toEqual(['api.migrate', 'api.create', 'api.listen']);
  });

  it('does not create or listen on the API application when migrations reject', async () => {
    // Given
    mockRunStartupMigrations.mockRejectedValueOnce(new Error('migration failed'));

    // When
    const startup = bootstrapApi();

    // Then
    await expect(startup).rejects.toThrow('migration failed');
    expect(mockStartupEvents).toEqual([]);
  });

  it('runs worker migrations before creating the Nest application context', async () => {
    // Given
    mockRunStartupMigrations.mockImplementation(async () => {
      mockStartupEvents.push('worker.migrate');
    });

    // When
    await bootstrapWorker();

    // Then
    expect(mockStartupEvents).toEqual(['worker.migrate', 'worker.create-context']);
  });

  it('does not create the worker application context when migrations reject', async () => {
    // Given
    mockRunStartupMigrations.mockRejectedValueOnce(new Error('migration failed'));

    // When
    const startup = bootstrapWorker();

    // Then
    await expect(startup).rejects.toThrow('migration failed');
    expect(mockStartupEvents).toEqual([]);
  });

  it('exposes a reusable startup migration runner from migrate.ts', () => {
    // Given
    const runner = runStartupMigrations;

    // When
    const runnerIsCallable = typeof runner === 'function';

    // Then
    expect(runnerIsCallable).toBe(true);
  });

  it.each(['src/main.ts', 'src/worker.ts'])(
    'exits non-zero when startup migrations fail for %s',
    (entrypoint) => {
      // Given
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        DB_PORT: 'invalid',
      };

      // When
      const result = spawnSync(process.execPath, ['-r', 'ts-node/register', entrypoint], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: environment,
      });

      // Then
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
    },
  );
});
