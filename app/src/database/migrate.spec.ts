import { describe, expect, it } from '@jest/globals';

import { buildClientConfig } from './migrate';

describe('buildClientConfig', () => {
  it('uses local database defaults with TLS disabled and UTC sessions', () => {
    const config = buildClientConfig({});

    expect(config).toEqual({
      database: 'learning',
      host: 'localhost',
      options: '-c timezone=UTC',
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

    expect(config).toMatchObject({
      options: '-c timezone=UTC',
      ssl: {
        ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
        rejectUnauthorized: true,
      },
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
