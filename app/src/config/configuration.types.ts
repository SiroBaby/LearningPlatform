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
  errorBackoffMs: number;
  jobBatchSize: number;
  outboxBatchSize: number;
  pollIntervalMs: number;
  stuckJobBatchSize: number;
  stuckJobTimeoutMs: number;
}

export const CONFIG_PATH = {
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
    errorBackoffMs: 'worker.errorBackoffMs',
    jobBatchSize: 'worker.jobBatchSize',
    outboxBatchSize: 'worker.outboxBatchSize',
    pollIntervalMs: 'worker.pollIntervalMs',
    stuckJobBatchSize: 'worker.stuckJobBatchSize',
    stuckJobTimeoutMs: 'worker.stuckJobTimeoutMs',
  },
} as const;
