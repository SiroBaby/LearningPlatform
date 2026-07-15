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

  it('allows the deterministic fake provider outside production', () => {
    const config = new ConfigService({
      ai: {
        openai: { requestTimeoutMs: 60_000 },
        provider: 'fake',
      },
      app: { env: 'development' },
    });

    expect(new ApplicationConfigService(config).ai).toEqual({
      openai: {
        apiKey: undefined,
        model: undefined,
        requestTimeoutMs: 60_000,
      },
      provider: 'fake',
    });
  });

  it('requires the OpenAI provider and credentials in production', () => {
    const fake = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: { requestTimeoutMs: 60_000 },
        provider: 'fake',
      },
      app: { env: 'production' },
    }));
    const missingCredentials = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: { requestTimeoutMs: 60_000 },
        provider: 'openai',
      },
      app: { env: 'production' },
    }));

    expect(() => fake.ai).toThrow('AI_LLM_PROVIDER must be openai in production');
    expect(() => missingCredentials.ai).toThrow(
      'OPENAI_API_KEY and OPENAI_MODEL are required for the OpenAI provider',
    );
  });
});
