import { describe, expect, it } from '@jest/globals';

import { ApplicationConfigService } from '../config/application-config.service';
import { TypeOrmConfigService } from './typeorm-config.service';

describe('TypeOrmConfigService', () => {
  it('configures verified TLS at the TypeORM PostgreSQL option level and keeps sessions in UTC', () => {
    const config = {
      database: {
        host: 'localhost',
        name: 'learning',
        password: 'learning',
        port: 5432,
        ssl: {
          ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
          mode: 'verify-ca',
        },
        user: 'learning',
      },
    } as unknown as ApplicationConfigService;
    const service = new TypeOrmConfigService(config);

    expect(service.createTypeOrmOptions()).toMatchObject({
      extra: { options: '-c timezone=UTC' },
      ssl: {
        ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
        rejectUnauthorized: true,
      },
      type: 'postgres',
    });
  });

  it('does not configure TypeORM SSL when TLS is disabled', () => {
    const config = {
      database: {
        host: 'localhost',
        name: 'learning',
        password: 'learning',
        port: 5432,
        ssl: { mode: 'disabled' },
        user: 'learning',
      },
    } as unknown as ApplicationConfigService;
    const service = new TypeOrmConfigService(config);

    expect(service.createTypeOrmOptions()).not.toHaveProperty('ssl');
  });
});
