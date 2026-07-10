import { describe, expect, it } from '@jest/globals';

import { ApplicationConfigService } from '../config/application-config.service';
import { TypeOrmConfigService } from './typeorm-config.service';

describe('TypeOrmConfigService', () => {
  it('khởi tạo mọi PostgreSQL session theo UTC', () => {
    const config = {
      database: {
        host: 'localhost',
        name: 'learning',
        password: 'learning',
        port: 5432,
        user: 'learning',
      },
    } as unknown as ApplicationConfigService;
    const service = new TypeOrmConfigService(config);

    expect(service.createTypeOrmOptions()).toMatchObject({
      extra: { options: '-c timezone=UTC' },
      type: 'postgres',
    });
  });
});
