import { describe, expect, it, jest } from '@jest/globals';

import {
  buildClientConfig,
  closeClient,
  closeClientAfterMigration,
  type MigrationLockClient,
  runWithinMigrationDeadline,
  withLock,
} from './migrate';

describe('buildClientConfig', () => {
  it('uses local database defaults with TLS disabled and bounded UTC sessions', () => {
    const config = buildClientConfig({});

    expect(config).toEqual({
      connectionTimeoutMillis: 10_000,
      database: 'learning',
      host: 'localhost',
      application_name: 'learning-platform-migration',
      lock_timeout: 30_000,
      options: '-c timezone=UTC -c lock_timeout=30000ms -c statement_timeout=240000ms',
      password: 'learning',
      port: 5432,
      query_timeout: 240_000,
      statement_timeout: 240_000,
      user: 'learning',
    });
  });

  it('configures verified TLS when DB_SSL_MODE is verify-ca', () => {
    const config = buildClientConfig({
      DB_SSL_CA: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
      DB_SSL_MODE: 'verify-ca',
    });

    expect(config).toEqual({
      connectionTimeoutMillis: 10_000,
      database: 'learning',
      host: 'localhost',
      application_name: 'learning-platform-migration',
      lock_timeout: 30_000,
      options: '-c timezone=UTC -c lock_timeout=30000ms -c statement_timeout=240000ms',
      password: 'learning',
      port: 5432,
      query_timeout: 240_000,
      statement_timeout: 240_000,
      ssl: {
        ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
        rejectUnauthorized: true,
      },
      user: 'learning',
    });
  });

  it.each([undefined, '', '  \n\t  '])(
    'rejects a blank DB_SSL_CA when DB_SSL_MODE is verify-ca',
    (certificateAuthority) => {
      expect(() =>
        buildClientConfig({
          DB_SSL_CA: certificateAuthority,
          DB_SSL_MODE: 'verify-ca',
        }),
      ).toThrow('DB_SSL_CA must be a non-blank string when DB_SSL_MODE is verify-ca');
    },
  );

  it.each(['0', '65536', 'not-a-number', '5432.5', '5432abc'])(
    'rejects invalid DB_PORT values',
    (port) => {
      expect(() => buildClientConfig({ DB_PORT: port })).toThrow(
        'DB_PORT must be a valid integer',
      );
    },
  );

  it('rejects an unsupported DB_SSL_MODE', () => {
    expect(() => buildClientConfig({ DB_SSL_MODE: 'require' })).toThrow(
      'DB_SSL_MODE must be disabled or verify-ca',
    );
  });
});

describe('withLock', () => {
  it('polls until the advisory lock becomes available', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const sleeps: number[] = [];
    const acquisitionResults = [false, true];
    const client: MigrationLockClient = {
      query: async (text, values = []) => {
        calls.push([text, values]);
        return { rows: [{ acquired: acquisitionResults.shift() ?? true }] };
      },
    };

    await withLock(client, async () => undefined, {
      now: () => 0,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(sleeps).toEqual([1_000]);
    expect(calls).toEqual([
      ['SELECT pg_try_advisory_lock($1) AS acquired', [4815162342]],
      ['SELECT pg_try_advisory_lock($1) AS acquired', [4815162342]],
      ['SELECT pg_advisory_unlock($1)', [4815162342]],
    ]);
  });

  it('fails with a stable message and does not unlock when the deadline expires', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const times = [0, 0, 60_000];
    const client: MigrationLockClient = {
      query: async (text, values = []) => {
        calls.push([text, values]);
        return { rows: [{ acquired: false }] };
      },
    };

    await expect(
      withLock(client, async () => undefined, {
        deadlineMillis: 60_000,
        now: () => times.shift() ?? 60_000,
      }),
    ).rejects.toThrow('Migration advisory lock could not be acquired before the lock deadline.');

    expect(calls).toEqual([['SELECT pg_try_advisory_lock($1) AS acquired', [4815162342]]]);
  });

  it('releases the advisory lock when migration work fails', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const client: MigrationLockClient = {
      query: async (text, values = []) => {
        calls.push([text, values]);
        return { rows: [{ acquired: true }] };
      },
    };

    await expect(
      withLock(client, async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');

    expect(calls).toEqual([
      ['SELECT pg_try_advisory_lock($1) AS acquired', [4815162342]],
      ['SELECT pg_advisory_unlock($1)', [4815162342]],
    ]);
  });

  it('preserves migration failure when advisory unlock also fails', async () => {
    let queryCount = 0;
    const client: MigrationLockClient = {
      query: async () => {
        queryCount += 1;
        if (queryCount === 2) {
          throw new Error('unlock failed');
        }
        return { rows: [{ acquired: true }] };
      },
    };

    await expect(
      withLock(client, async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');
  });
});

describe('migration deadline and cleanup', () => {
  function createCleanupClient(end: () => Promise<void>) {
    const destroy = jest.fn();
    return {
      client: { connection: { stream: { destroy } }, end },
      destroy,
    };
  }

  it('closes the client when end succeeds', async () => {
    const end = jest.fn(async () => undefined);
    const { client, destroy } = createCleanupClient(end);

    await closeClient(client);

    expect(end).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('destroys the stream when client cleanup exceeds its bound', async () => {
    const { client, destroy } = createCleanupClient(() => new Promise<void>(() => undefined));

    await expect(closeClient(client)).rejects.toThrow('Migration database cleanup failed.');

    expect(destroy).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('preserves the primary migration failure when cleanup fails', async () => {
    const { client } = createCleanupClient(async () => {
      throw new Error('cleanup failed');
    });

    await expect(closeClientAfterMigration(client, new Error('migration failed'))).resolves.toBeUndefined();
  });

  it('destroys the connection and rejects at the total operation deadline', async () => {
    const { client, destroy } = createCleanupClient(async () => undefined);
    const deadlineMarker = jest.fn();

    await expect(
      runWithinMigrationDeadline(client, () => new Promise<void>(() => undefined), {
        deadlineMillis: 1,
        onDeadline: deadlineMarker,
      }),
    ).rejects.toThrow('Migration runtime deadline exceeded.');

    expect(deadlineMarker).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
