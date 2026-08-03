import { describe, expect, it } from '@jest/globals';

import { buildClientConfig, type MigrationLockClient, withLock } from './migrate';

describe('buildClientConfig', () => {
  it('uses local database defaults with TLS disabled and bounded UTC sessions', () => {
    const config = buildClientConfig({});

    expect(config).toEqual({
      connectionTimeoutMillis: 10_000,
      database: 'learning',
      host: 'localhost',
      options: '-c timezone=UTC -c lock_timeout=30s -c statement_timeout=480s',
      password: 'learning',
      port: 5432,
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
      options: '-c timezone=UTC -c lock_timeout=30s -c statement_timeout=480s',
      password: 'learning',
      port: 5432,
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
  it('releases the advisory lock when migration work fails', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const client: MigrationLockClient = {
      query: async (text, values = []) => {
        calls.push([text, values]);
      },
    };

    await expect(
      withLock(client, async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');

    expect(calls).toEqual([
      ['SELECT pg_advisory_lock($1)', [4815162342]],
      ['SELECT pg_advisory_unlock($1)', [4815162342]],
    ]);
  });
});
