export interface SwaggerSettings {
  enabled: boolean;
  password: string | undefined;
  username: string | undefined;
}

export interface ApplicationSettings {
  environment: string;
  port: number;
  swagger: SwaggerSettings;
}

export type LlmProviderType = 'fake' | 'openai';
export type LlmCapabilityVersion = 'chat-completions-json-v1' | 'responses-json-v1';
export type LlmStructuredOutputMode = 'json-object' | 'json-schema-strict';
export type LlmTransport = 'chat-completions' | 'responses';
export type DatabaseSslMode = 'disabled' | 'verify-ca';

export interface OpenAiGeneralSettings {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  capabilityVersion: string | undefined;
  model: string | undefined;
  requestTimeoutMs: number;
  structuredOutputMode: string | undefined;
  transport: string | undefined;
}

export interface AiSettings {
  credentialEncryption: {
    key: string | undefined;
    mode: 'kms' | 'local';
  };
  openai: OpenAiGeneralSettings;
  provider: LlmProviderType;
  plans: {
    free: { creditBalance: number };
    paid: { creditBalance: number };
  };
  platformModels: readonly {
    creditPerInputToken: number;
    creditPerOutputToken: number;
    id: string;
    label: string;
    model: string;
    planIds: readonly string[];
  }[];
}

export type LlmProviderSettings =
  | {
      provider: 'fake';
    }
  | {
      openai: {
        apiKey: string;
        baseUrl: string;
        capabilityVersion: LlmCapabilityVersion;
        model: string;
        requestTimeoutMs: number;
        structuredOutputMode: LlmStructuredOutputMode;
        transport: LlmTransport;
      };
      provider: 'openai';
    };

export interface DatabaseSettings {
  host: string;
  name: string;
  password: string;
  port: number;
  readonly ssl:
    | {
        readonly mode: 'disabled';
      }
    | {
        readonly ca: string;
        readonly mode: 'verify-ca';
      };
  user: string;
}

export interface StorageSettings {
  accessKey: string;
  bucket: string;
  endpoint: string;
  port: number;
  presignExpiry: number;
  region: string;
  secretKey: string;
  useSSL: boolean;
}

export interface WorkerSettings {
  chunkInsertBatchSize: number;
  chunkMaxChars: number;
  maxChunksPerDocument: number;
  maxChunkTotalChars: number;
  chunkOverlapChars: number;
  chunkTargetChars: number;
  errorBackoffMs: number;
  healthHost: string;
  healthPort: number;
  maxExtractableObjectBytes: number;
  jobBatchSize: number;
  outboxBatchSize: number;
  pollIntervalMs: number;
  quizGenerationConcurrency: number;
  stuckJobBatchSize: number;
  stuckJobTimeoutMs: number;
}

export const CONFIG_PATH = {
  ai: {
    credentialEncryption: { key: 'ai.credentialEncryption.key', mode: 'ai.credentialEncryption.mode' },
    openai: {
      apiKey: 'ai.openai.apiKey',
      baseUrl: 'ai.openai.baseUrl',
      capabilityVersion: 'ai.openai.capabilityVersion',
      model: 'ai.openai.model',
      requestTimeoutMs: 'ai.openai.requestTimeoutMs',
      structuredOutputMode: 'ai.openai.structuredOutputMode',
      transport: 'ai.openai.transport',
    },
    provider: 'ai.provider',
  },
  app: {
    environment: 'app.env',
    port: 'app.port',
    swagger: {
      enabled: 'app.swagger.enabled',
      password: 'app.swagger.password',
      username: 'app.swagger.username',
    },
  },
  database: {
    host: 'database.host',
    name: 'database.name',
    password: 'database.password',
    port: 'database.port',
    ssl: {
      ca: 'database.ssl.ca',
      mode: 'database.ssl.mode',
    },
    user: 'database.user',
  },
  storage: {
    accessKey: 'storage.accessKey',
    bucket: 'storage.bucket',
    endpoint: 'storage.endpoint',
    port: 'storage.port',
    presignExpiry: 'storage.presignExpiry',
    region: 'storage.region',
    secretKey: 'storage.secretKey',
    useSSL: 'storage.useSSL',
  },
  worker: {
    chunkInsertBatchSize: 'worker.chunkInsertBatchSize',
    chunkMaxChars: 'worker.chunkMaxChars',
    maxChunksPerDocument: 'worker.maxChunksPerDocument',
    maxChunkTotalChars: 'worker.maxChunkTotalChars',
    chunkOverlapChars: 'worker.chunkOverlapChars',
    chunkTargetChars: 'worker.chunkTargetChars',
    errorBackoffMs: 'worker.errorBackoffMs',
    healthHost: 'worker.healthHost',
    healthPort: 'worker.healthPort',
    maxExtractableObjectBytes: 'worker.maxExtractableObjectBytes',
    jobBatchSize: 'worker.jobBatchSize',
    outboxBatchSize: 'worker.outboxBatchSize',
    pollIntervalMs: 'worker.pollIntervalMs',
    quizGenerationConcurrency: 'worker.quizGenerationConcurrency',
    stuckJobBatchSize: 'worker.stuckJobBatchSize',
    stuckJobTimeoutMs: 'worker.stuckJobTimeoutMs',
  },
} as const;
