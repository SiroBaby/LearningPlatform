import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';

describe('ApplicationConfigService', () => {
  it('fails fast for insecure storage settings in production', () => {
    const config = new ConfigService({
      app: { env: 'production' },
      storage: {
        accessKey: 'minioadmin',
        bucket: 'documents',
        endpoint: 'storage.internal',
        port: 9000,
        presignExpiry: 300,
        secretKey: 'minioadmin',
        useSSL: false,
      },
    });

    expect(() => new ApplicationConfigService(config).storage).toThrow(
      'MINIO_USE_SSL must be true in production',
    );
  });
});
