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

export interface AiSettings {
  openai: {
    apiKey: string | undefined;
    model: string | undefined;
    requestTimeoutMs: number;
  };
  provider: LlmProviderType;
}

export interface DatabaseSettings {
  host: string;
  name: string;
  password: string;
  port: number;
  user: string;
}

export interface StorageSettings {
  accessKey: string;
  bucket: string;
  endpoint: string;
  port: number;
  presignExpiry: number;
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
  maxExtractableObjectBytes: number;
  jobBatchSize: number;
  outboxBatchSize: number;
  pollIntervalMs: number;
  stuckJobBatchSize: number;
  stuckJobTimeoutMs: number;
}

export const CONFIG_PATH = {
  ai: {
    openai: {
      apiKey: 'ai.openai.apiKey',
      model: 'ai.openai.model',
      requestTimeoutMs: 'ai.openai.requestTimeoutMs',
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
    user: 'database.user',
  },
  storage: {
    accessKey: 'storage.accessKey',
    bucket: 'storage.bucket',
    endpoint: 'storage.endpoint',
    port: 'storage.port',
    presignExpiry: 'storage.presignExpiry',
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
    maxExtractableObjectBytes: 'worker.maxExtractableObjectBytes',
    jobBatchSize: 'worker.jobBatchSize',
    outboxBatchSize: 'worker.outboxBatchSize',
    pollIntervalMs: 'worker.pollIntervalMs',
    stuckJobBatchSize: 'worker.stuckJobBatchSize',
    stuckJobTimeoutMs: 'worker.stuckJobTimeoutMs',
  },
} as const;
