import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';

const workerConfig = (overrides?: Partial<{
  readonly healthHost: string;
  readonly healthPort: number;
  readonly quizGenerationConcurrency: number;
}>): Record<string, unknown> => ({
  worker: {
    chunkInsertBatchSize: 500,
    chunkMaxChars: 1_500,
    chunkOverlapChars: 150,
    chunkTargetChars: 1_200,
    errorBackoffMs: 5_000,
    healthHost: overrides?.healthHost ?? '0.0.0.0',
    healthPort: overrides?.healthPort ?? 3_403,
    jobBatchSize: 10,
    maxChunksPerDocument: 20_000,
    maxChunkTotalChars: 24_000_000,
    maxExtractableObjectBytes: 20_971_520,
    outboxBatchSize: 100,
    pollIntervalMs: 1_000,
    quizGenerationConcurrency: overrides?.quizGenerationConcurrency ?? 8,
    stuckJobBatchSize: 100,
    stuckJobTimeoutMs: 300_000,
  },
});

const databaseConfig = (
  environment: string,
  ssl: { readonly ca?: string; readonly mode: string },
): ApplicationConfigService => new ApplicationConfigService(new ConfigService({
  app: { env: environment },
  database: {
    host: 'aiven.example.com',
    name: 'learning',
    password: 'learning',
    port: 5432,
    ssl,
    user: 'learning',
  },
}));

describe('ApplicationConfigService', () => {

  it('returns verified database TLS settings when a CA is configured', () => {
    const config = databaseConfig('development', {
      ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
      mode: 'verify-ca',
    });

    expect(config.database.ssl).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\ncertificate\n-----END CERTIFICATE-----',
      mode: 'verify-ca',
    });
  });

  it('rejects unsupported database TLS modes and blank verification CAs', () => {
    const invalidMode = databaseConfig('development', { mode: 'required' });
    const blankCa = databaseConfig('development', { ca: '   ', mode: 'verify-ca' });

    expect(() => invalidMode.database).toThrow('DB_SSL_MODE must be disabled or verify-ca');
    expect(() => blankCa.database).toThrow('DB_SSL_CA must be a non-blank string when DB_SSL_MODE is verify-ca');
  });

  it('rejects disabled database TLS in production', () => {
    const config = databaseConfig('production', { mode: 'disabled' });

    expect(() => config.database).toThrow('DB_SSL_MODE must be verify-ca in production');
  });

  it('fails fast for insecure storage settings in production', () => {
    const config = new ConfigService({
      app: { env: 'production' },
      storage: {
        accessKey: 'minioadmin',
        bucket: 'documents',
        endpoint: 'storage.internal',
        port: 9000,
        presignExpiry: 300,
        region: 'us-east-1',
        secretKey: 'minioadmin',
        useSSL: false,
      },
    });

    expect(() => new ApplicationConfigService(config).storage).toThrow(
      'OBJECT_STORAGE_USE_SSL must be true in production',
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

  it('allows production API AI settings without worker OpenAI credentials', () => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        credentialEncryption: {
          key: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0MTIzNDU2Nzg5MDE=',
          mode: 'local',
        },
        openai: { requestTimeoutMs: 60_000 },
        plans: {
          free: { creditBalance: 100 },
          paid: { creditBalance: 200 },
        },
        platformModels: [{
          creditPerInputToken: 1,
          creditPerOutputToken: 2,
          id: 'platform-default',
          label: 'Fast platform model',
          model: 'gpt-4.1-mini',
          planIds: ['free', 'paid'],
        }],
        provider: 'openai',
      },
      app: { env: 'production' },
    }));

    expect(config.ai).toMatchObject({
      credentialEncryption: {
        key: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0MTIzNDU2Nzg5MDE=',
        mode: 'local',
      },
      openai: {
        apiKey: undefined,
        baseUrl: undefined,
        capabilityVersion: undefined,
        model: undefined,
        requestTimeoutMs: 60_000,
        structuredOutputMode: undefined,
        transport: undefined,
      },
      plans: {
        free: { creditBalance: 100 },
        paid: { creditBalance: 200 },
      },
      provider: 'openai',
    });
  });

  it('requires the OpenAI provider and credentials at the worker LLM provider boundary in production', () => {
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

    expect(() => fake.llmProvider).toThrow('AI_LLM_PROVIDER must be openai in production');
    expect(() => missingCredentials.llmProvider).toThrow(
      'OpenAI-compatible provider configuration is incomplete',
    );
  });

  it('returns canonical operator-managed worker OpenAI-compatible settings', () => {
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

    expect(config.llmProvider).toMatchObject({
      openai: {
        baseUrl: 'https://proxy.example.com/v1',
        structuredOutputMode: 'json-schema-strict',
        transport: 'responses',
      },
      provider: 'openai',
    });
  });

  it.each([
    ['responses-json-v1', 'responses'],
    ['chat-completions-json-v1', 'chat-completions'],
  ] as const)('accepts the coherent %s capability and %s transport pair', (capabilityVersion, transport) => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'proxy-key',
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion,
          model: 'proxy-model',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-schema-strict',
          transport,
        },
        provider: 'openai',
      },
      app: { env: 'development' },
    }));

    expect(config.llmProvider).toMatchObject({
      openai: { capabilityVersion, transport },
      provider: 'openai',
    });
  });

  it.each([
    ['responses-json-v1', 'chat-completions'],
    ['chat-completions-json-v1', 'responses'],
  ] as const)('rejects incoherent %s capability and %s transport pair', (capabilityVersion, transport) => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'proxy-key',
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion,
          model: 'proxy-model',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-schema-strict',
          transport,
        },
        provider: 'openai',
      },
      app: { env: 'development' },
    }));

    expect(() => config.llmProvider).toThrow('OPENAI_CAPABILITY_VERSION must match OPENAI_TRANSPORT');
  });

  it('rejects an unknown OpenAI capability version', () => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'proxy-key',
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion: 'unknown',
          model: 'proxy-model',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-schema-strict',
          transport: 'responses',
        },
        provider: 'openai',
      },
      app: { env: 'development' },
    }));

    expect(() => config.llmProvider).toThrow(
      'OPENAI_CAPABILITY_VERSION must be responses-json-v1 or chat-completions-json-v1',
    );
  });

  it('rejects invalid OpenAI-compatible capabilities and endpoint URLs', () => {
    const create = (baseUrl: string, transport: string): ApplicationConfigService =>
      new ApplicationConfigService(new ConfigService({
        ai: {
          openai: {
            apiKey: 'proxy-key',
            baseUrl,
            capabilityVersion: 'responses-json-v1',
            model: 'proxy-model',
            requestTimeoutMs: 60_000,
            structuredOutputMode: 'json-object',
            transport,
          },
          provider: 'openai',
        },
        app: { env: 'development' },
      }));

    expect(() => create('https://proxy.example.com/v1?token=x', 'responses').llmProvider).toThrow(
      'OPENAI_BASE_URL must not contain credentials, query parameters, or a fragment',
    );
    expect(() => create('https://proxy.example.com/v1', 'automatic').llmProvider).toThrow(
      'OPENAI_TRANSPORT must be responses or chat-completions',
    );
  });

  it('returns typed worker health host and port settings', () => {
    const config = new ApplicationConfigService(new ConfigService(workerConfig({
      healthHost: '127.0.0.1',
      healthPort: 3403,
    })));

    expect(config.worker.healthHost).toBe('127.0.0.1');
    expect(config.worker.healthPort).toBe(3403);
    expect(config.worker.quizGenerationConcurrency).toBe(8);
  });

  it('rejects an invalid worker health port', () => {
    const config = new ApplicationConfigService(new ConfigService(workerConfig({ healthPort: 0 })));

    expect(() => config.worker).toThrow('Configuration worker.healthPort must be a valid TCP port');
  });

  it('rejects a non-positive quiz generation concurrency cap', () => {
    const config = new ApplicationConfigService(new ConfigService(workerConfig({ quizGenerationConcurrency: 0 })));

    expect(() => config.worker).toThrow('Configuration worker.quizGenerationConcurrency must be a positive integer');
  });
});
