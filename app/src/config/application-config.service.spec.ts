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

    expect(new ApplicationConfigService(config).ai).toMatchObject({
      openai: {
        apiKey: undefined,
        baseUrl: undefined,
        capabilityVersion: undefined,
        model: undefined,
        requestTimeoutMs: 60_000,
        structuredOutputMode: undefined,
        transport: undefined,
      },
      provider: 'fake',
    });
  });

  it('does not validate unused OpenAI-compatible settings for the fake provider', () => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          baseUrl: 'not-a-url',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'unsupported',
          transport: 'automatic',
        },
        provider: 'fake',
      },
      app: { env: 'development' },
    }));

    expect(config.ai.provider).toBe('fake');
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
      'OpenAI-compatible provider configuration is incomplete',
    );
  });

  it('returns canonical operator-managed OpenAI-compatible settings', () => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'proxy-key',
          baseUrl: 'https://proxy.example.com/v1/',
          capabilityVersion: 'responses-json-v1',
          model: 'proxy-model',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-schema-strict',
          transport: 'responses',
        },
        provider: 'openai',
      },
      app: { env: 'development' },
    }));

    expect(config.ai.openai).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      structuredOutputMode: 'json-schema-strict',
      transport: 'responses',
    });
  });

  it('rejects invalid OpenAI-compatible capabilities and endpoint URLs', () => {
    const create = (baseUrl: string, transport: string): ApplicationConfigService =>
      new ApplicationConfigService(new ConfigService({
        ai: {
          openai: {
            apiKey: 'proxy-key',
            baseUrl,
            capabilityVersion: 'v1',
            model: 'proxy-model',
            requestTimeoutMs: 60_000,
            structuredOutputMode: 'json-object',
            transport,
          },
          provider: 'openai',
        },
        app: { env: 'development' },
      }));

    expect(() => create('https://proxy.example.com/v1?token=x', 'responses').ai).toThrow(
      'OPENAI_BASE_URL must not contain credentials, query parameters, or a fragment',
    );
    expect(() => create('https://proxy.example.com/v1', 'automatic').ai).toThrow(
      'OPENAI_TRANSPORT must be responses or chat-completions',
    );
  });
});
