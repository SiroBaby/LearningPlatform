import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ApplicationSettings,
  CONFIG_PATH,
  DatabaseSettings,
  StorageSettings,
  WorkerSettings,
} from './configuration.types';

@Injectable()
export class ApplicationConfigService {
  constructor(private readonly config: ConfigService) {}

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
    return {
      errorBackoffMs: this.positiveInteger(CONFIG_PATH.worker.errorBackoffMs),
      jobBatchSize: this.positiveInteger(CONFIG_PATH.worker.jobBatchSize),
      outboxBatchSize: this.positiveInteger(CONFIG_PATH.worker.outboxBatchSize),
      pollIntervalMs: this.positiveInteger(CONFIG_PATH.worker.pollIntervalMs),
      stuckJobBatchSize: this.positiveInteger(CONFIG_PATH.worker.stuckJobBatchSize),
      stuckJobTimeoutMs: this.positiveInteger(CONFIG_PATH.worker.stuckJobTimeoutMs),
    };
  }

  private required<T>(path: string): T {
    const value = this.config.get<T>(path);
    if (value === undefined) {
      throw new Error(`Missing required configuration: ${path}`);
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
