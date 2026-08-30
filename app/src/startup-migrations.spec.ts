import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'child_process';

const mockStartupEvents: string[] = [];
const mockRunStartupMigrations = jest.fn<() => Promise<void>>();
const mockInternalMtlsClose = jest.fn<() => Promise<void>>();
const mockApiClose = jest.fn<() => Promise<void>>();
const mockAppUse = jest.fn();
const mockLoggerError = jest.fn();
const mockLoggerLog = jest.fn();
const mockApplicationLogger = {
  error: mockLoggerError,
  log: mockLoggerLog,
};
let httpCloseListener: (() => void) | undefined;
const mockHttpServer = {
  once: jest.fn((event: string, listener: () => void) => {
    if (event === 'close') httpCloseListener = listener;
    return mockHttpServer;
  }),
  emit: jest.fn((event: string) => {
    if (event === 'close') httpCloseListener?.();
    return true;
  }),
};

jest.mock('./database/migrate', () => ({
  runStartupMigrations: mockRunStartupMigrations,
}));

jest.mock('./internal-mtls-server', () => ({
  createInternalMtlsServer: async () => ({
    close: mockInternalMtlsClose,
    server: { listen: async (port: number, callback: () => void) => callback() },
  }),
}));

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: async () => {
      mockStartupEvents.push('api.create');
      return {
        enableShutdownHooks: () => undefined,
        close: mockApiClose,
        get: () => ({
          application: {
            internalMtls: {
              caPath: '/tmp/ca.crt',
              certPath: '/tmp/server.crt',
              enabled: true,
              expectedClientSpiffeUri: 'spiffe://test',
              keyPath: '/tmp/server.key',
              port: 9443,
            },
            port: 3000,
            swagger: { enabled: false },
          },
        }),
        getHttpServer: () => mockHttpServer,
        listen: async () => {
          mockStartupEvents.push('api.listen');
        },
        setGlobalPrefix: () => undefined,
        use: mockAppUse,
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
  createApplicationLogger: () => mockApplicationLogger,
}));

import {
  ApiBootstrapError,
  bootstrapApi,
  formatApiBootstrapFailure,
  logApiBootstrapFailure,
} from './main';
import { runStartupMigrations } from './database/migrate';
import { bootstrapWorker } from './worker';

describe('backend-owned startup migrations', () => {
  beforeEach(() => {
    mockStartupEvents.splice(0);
    mockRunStartupMigrations.mockReset();
    mockInternalMtlsClose.mockReset();
    mockApiClose.mockReset();
    mockAppUse.mockReset();
    mockLoggerError.mockReset();
    mockLoggerLog.mockReset();
    mockApiClose.mockImplementation(async () => {
      mockHttpServer.emit('close');
    });
    mockHttpServer.once.mockClear();
    mockHttpServer.emit.mockClear();
    httpCloseListener = undefined;
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

  it('closes the internal mTLS listener during normal API shutdown', async () => {
    mockRunStartupMigrations.mockResolvedValueOnce(undefined);

    await bootstrapApi();
    await mockApiClose();

    expect(mockHttpServer.once).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockInternalMtlsClose).toHaveBeenCalledTimes(1);
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

  it('records the failed API bootstrap stage and preserves the original cause', async () => {
    const cause = new Error('module setup failed');
    mockAppUse.mockImplementationOnce(() => {
      throw cause;
    });

    await expect(bootstrapApi()).rejects.toMatchObject({
      cause,
      stage: 'module-setup',
    });
  });

  it('logs safe API bootstrap failure metadata without raw secrets or URLs', () => {
    const cause = Object.assign(
      new Error(
        'provider failed apiKey=sk-secret Authorization: Bearer token-value https://provider.test/v1?token=secret',
      ),
      { code: 'PROVIDER_FAILED' },
    );
    const failure = new ApiBootstrapError('api-listen', cause);

    logApiBootstrapFailure(mockApplicationLogger, failure);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        causeCode: 'PROVIDER_FAILED',
        causeMessage: expect.stringContaining('provider failed'),
        causeType: 'Error',
        code: 'API_BOOTSTRAP_FAILED',
        errorMessage: expect.stringContaining('provider failed'),
        errorType: 'ApiBootstrapError',
        event: 'api.bootstrap.failed',
        runtime: 'api',
        stage: 'api-listen',
      }),
    );
    const loggedEvent = mockLoggerError.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(loggedEvent)).not.toContain('sk-secret');
    expect(JSON.stringify(loggedEvent)).not.toContain('token-value');
    expect(JSON.stringify(loggedEvent)).not.toContain('provider.test');
    expect(JSON.stringify(loggedEvent)).not.toContain('?token=secret');
  });

  it('formats unknown non-Error rejections safely', () => {
    expect(() => formatApiBootstrapFailure({ payload: 'secret' })).not.toThrow();
    expect(formatApiBootstrapFailure('bootstrap failed')).toMatchObject({
      errorMessage: 'bootstrap failed',
      errorType: 'string',
      stage: 'unknown',
    });
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

  it('fails closed before migrations when production does not use relay-only execution', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousWorkerExecutionMode = process.env.WORKER_EXECUTION_MODE;
    process.env.NODE_ENV = 'production';
    delete process.env.WORKER_EXECUTION_MODE;

    try {
      await expect(bootstrapWorker()).rejects.toThrow(
        'WORKER_EXECUTION_MODE=relay-only is required in production',
      );
      expect(mockStartupEvents).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousWorkerExecutionMode === undefined) delete process.env.WORKER_EXECUTION_MODE;
      else process.env.WORKER_EXECUTION_MODE = previousWorkerExecutionMode;
    }
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

  it('loads reflect metadata before AppModule from the API runtime entrypoint', () => {
    const loadOrderGuard = `
      const Module = require('module');
      let reflectMetadataLoaded = false;
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'reflect-metadata') reflectMetadataLoaded = true;
        if (
          request === './app.module' &&
          parent?.filename.endsWith('/src/main.ts') &&
          !reflectMetadataLoaded
        ) {
          throw new Error('reflect-metadata must load before AppModule');
        }
        return originalLoad.call(this, request, parent, isMain);
      };
      require('ts-node/register');
      require('./src/main');
    `;

    const result = spawnSync(process.execPath, ['-e', loadOrderGuard], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('reflect-metadata must load before AppModule');
  });
});
