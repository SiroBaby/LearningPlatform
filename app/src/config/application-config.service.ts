import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AiSettings,
  ApplicationSettings,
  CONFIG_PATH,
  DatabaseSettings,
  LlmStructuredOutputMode,
  LlmTransport,
  StorageSettings,
  WorkerSettings,
} from './configuration.types';

@Injectable()
export class ApplicationConfigService {
  constructor(private readonly config: ConfigService) {}

  get ai(): AiSettings {
    const provider = this.required<string>(CONFIG_PATH.ai.provider);
    if (provider !== 'fake' && provider !== 'openai') {
      throw new Error('AI_LLM_PROVIDER must be fake or openai');
    }
    if (this.required<string>(CONFIG_PATH.app.environment) === 'production' && provider !== 'openai') {
      throw new Error('AI_LLM_PROVIDER must be openai in production');
    }
    const requestTimeoutMs = this.positiveInteger(CONFIG_PATH.ai.openai.requestTimeoutMs);
    const apiKey = this.config.get<string>(CONFIG_PATH.ai.openai.apiKey);
    const configuredBaseUrl = this.config.get<string>(CONFIG_PATH.ai.openai.baseUrl);
    const capabilityVersion = this.config.get<string>(CONFIG_PATH.ai.openai.capabilityVersion);
    const model = this.config.get<string>(CONFIG_PATH.ai.openai.model);
    const configuredStructuredOutputMode = this.config.get<string>(
      CONFIG_PATH.ai.openai.structuredOutputMode,
    );
    const configuredTransport = this.config.get<string>(CONFIG_PATH.ai.openai.transport);
    const credentialEncryptionMode = this.config.get<string>(CONFIG_PATH.ai.credentialEncryption.mode) ?? 'local';
    if (credentialEncryptionMode !== 'local' && credentialEncryptionMode !== 'kms') {
      throw new Error('AI_CREDENTIAL_ENCRYPTION_MODE must be local or kms');
    }
    const credentialEncryption = {
      key: this.config.get<string>(CONFIG_PATH.ai.credentialEncryption.key),
      mode: credentialEncryptionMode,
    } as const;
    const platformModels = this.config.get<AiSettings['platformModels']>('ai.platformModels') ?? [{
      creditPerInputToken: 1,
      creditPerOutputToken: 2,
      id: 'platform-default',
      label: 'Fast platform model',
      model: model ?? 'gpt-4.1-mini',
      planIds: ['free', 'paid'],
    }];
    if (platformModels.length === 0 || platformModels.some((model) => !model.id.trim() || !model.model.trim() || model.creditPerInputToken < 0 || model.creditPerOutputToken < 0)) {
      throw new Error('AI platform model catalog is invalid');
    }
    const plans = this.config.get<AiSettings['plans']>('ai.plans') ?? {
      free: { creditBalance: 10_000 },
      paid: { creditBalance: 100_000 },
    };
    if (!plans || !Number.isSafeInteger(plans.free.creditBalance) || plans.free.creditBalance < 0 || !Number.isSafeInteger(plans.paid.creditBalance) || plans.paid.creditBalance < 0) {
      throw new Error('AI plan configuration is invalid');
    }
    if (provider === 'fake') {
      return {
        credentialEncryption,
        openai: {
          apiKey,
          baseUrl: configuredBaseUrl,
          capabilityVersion,
          model,
          requestTimeoutMs,
          structuredOutputMode: undefined,
          transport: undefined,
        },
        provider,
        plans,
        platformModels,
      };
    }
    if (
      !apiKey?.trim() ||
        !configuredBaseUrl?.trim() ||
        !capabilityVersion?.trim() ||
        !model?.trim() ||
        !configuredStructuredOutputMode?.trim() ||
        !configuredTransport?.trim()
    ) {
      throw new Error('OpenAI-compatible provider configuration is incomplete');
    }
    const baseUrl = this.canonicalOpenAiBaseUrl(configuredBaseUrl);
    const structuredOutputMode = this.openAiStructuredOutputMode(configuredStructuredOutputMode);
    const transport = this.openAiTransport(configuredTransport);
    return {
      credentialEncryption,
      openai: {
        apiKey,
        baseUrl,
        capabilityVersion,
        model,
        requestTimeoutMs,
        structuredOutputMode,
        transport,
      },
      provider,
      plans,
      platformModels,
    };
  }

  get application(): ApplicationSettings {
    return {
      environment: this.required<string>(CONFIG_PATH.app.environment),
      port: this.required<number>(CONFIG_PATH.app.port),
      swagger: {
        enabled: this.required<boolean>(CONFIG_PATH.app.swagger.enabled),
        password: this.config.get<string>(CONFIG_PATH.app.swagger.password),
        username: this.config.get<string>(CONFIG_PATH.app.swagger.username),
      },
    };
  }

  get database(): DatabaseSettings {
    return {
      host: this.required<string>(CONFIG_PATH.database.host),
      name: this.required<string>(CONFIG_PATH.database.name),
      password: this.required<string>(CONFIG_PATH.database.password),
      port: this.required<number>(CONFIG_PATH.database.port),
      user: this.required<string>(CONFIG_PATH.database.user),
    };
  }

  get storage(): StorageSettings {
    const storage = {
      accessKey: this.required<string>(CONFIG_PATH.storage.accessKey),
      bucket: this.required<string>(CONFIG_PATH.storage.bucket),
      endpoint: this.required<string>(CONFIG_PATH.storage.endpoint),
      port: this.required<number>(CONFIG_PATH.storage.port),
      presignExpiry: this.required<number>(CONFIG_PATH.storage.presignExpiry),
      secretKey: this.required<string>(CONFIG_PATH.storage.secretKey),
      useSSL: this.required<boolean>(CONFIG_PATH.storage.useSSL),
    };
    this.assertProductionStorage(storage);
    return storage;
  }

  get worker(): WorkerSettings {
    const worker = {
      chunkInsertBatchSize: this.positiveInteger(CONFIG_PATH.worker.chunkInsertBatchSize),
      chunkMaxChars: this.positiveInteger(CONFIG_PATH.worker.chunkMaxChars),
      chunkOverlapChars: this.positiveInteger(CONFIG_PATH.worker.chunkOverlapChars),
      chunkTargetChars: this.positiveInteger(CONFIG_PATH.worker.chunkTargetChars),
      errorBackoffMs: this.positiveInteger(CONFIG_PATH.worker.errorBackoffMs),
      maxExtractableObjectBytes: this.positiveInteger(
        CONFIG_PATH.worker.maxExtractableObjectBytes,
      ),
      maxChunksPerDocument: this.positiveInteger(CONFIG_PATH.worker.maxChunksPerDocument),
      maxChunkTotalChars: this.positiveInteger(CONFIG_PATH.worker.maxChunkTotalChars),
      jobBatchSize: this.positiveInteger(CONFIG_PATH.worker.jobBatchSize),
      outboxBatchSize: this.positiveInteger(CONFIG_PATH.worker.outboxBatchSize),
      pollIntervalMs: this.positiveInteger(CONFIG_PATH.worker.pollIntervalMs),
      stuckJobBatchSize: this.positiveInteger(CONFIG_PATH.worker.stuckJobBatchSize),
      stuckJobTimeoutMs: this.positiveInteger(CONFIG_PATH.worker.stuckJobTimeoutMs),
    };
    if (worker.chunkTargetChars > worker.chunkMaxChars) {
      throw new Error('WORKER_CHUNK_TARGET_CHARS must not exceed WORKER_CHUNK_MAX_CHARS');
    }
    if (worker.chunkOverlapChars >= worker.chunkMaxChars) {
      throw new Error('WORKER_CHUNK_OVERLAP_CHARS must be below WORKER_CHUNK_MAX_CHARS');
    }
    return worker;
  }

  private required<T>(path: string): T {
    const value = this.config.get<T>(path);
    if (value === undefined) {
      throw new Error(`Missing required configuration: ${path}`);
    }

    return value;
  }

  private canonicalOpenAiBaseUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('OPENAI_BASE_URL must be an absolute HTTP or HTTPS URL');
      }
      throw error;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('OPENAI_BASE_URL must be an absolute HTTP or HTTPS URL');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        'OPENAI_BASE_URL must not contain credentials, query parameters, or a fragment',
      );
    }
    return url.toString().replace(/\/$/u, '');
  }

  private openAiStructuredOutputMode(value: string): LlmStructuredOutputMode {
    if (value !== 'json-object' && value !== 'json-schema-strict') {
      throw new Error(
        'OPENAI_STRUCTURED_OUTPUT_MODE must be json-schema-strict or json-object',
      );
    }
    return value;
  }

  private openAiTransport(value: string): LlmTransport {
    if (value !== 'chat-completions' && value !== 'responses') {
      throw new Error('OPENAI_TRANSPORT must be responses or chat-completions');
    }
    return value;
  }

  private positiveInteger(path: string): number {
    const value = this.required<number>(path);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Configuration ${path} must be a positive integer`);
    }
    return value;
  }

  private assertProductionStorage(storage: StorageSettings): void {
    if (this.required<string>(CONFIG_PATH.app.environment) !== 'production') return;
    if (!storage.useSSL) {
      throw new Error('MINIO_USE_SSL must be true in production');
    }
    if (
      storage.accessKey === 'minioadmin' ||
      storage.secretKey === 'minioadmin'
    ) {
      throw new Error('Default MinIO credentials are forbidden in production');
    }
  }
}
