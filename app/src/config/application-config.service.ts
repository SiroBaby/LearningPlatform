import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  ApplicationSettings,
  CONFIG_PATH,
  DatabaseSettings,
  StorageSettings,
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
    return {
      accessKey: this.required<string>(CONFIG_PATH.storage.accessKey),
      bucket: this.required<string>(CONFIG_PATH.storage.bucket),
      endpoint: this.required<string>(CONFIG_PATH.storage.endpoint),
      port: this.required<number>(CONFIG_PATH.storage.port),
      presignExpiry: this.required<number>(CONFIG_PATH.storage.presignExpiry),
      secretKey: this.required<string>(CONFIG_PATH.storage.secretKey),
      useSSL: this.required<boolean>(CONFIG_PATH.storage.useSSL),
    };
  }

  private required<T>(path: string): T {
    const value = this.config.get<T>(path);
    if (value === undefined) {
      throw new Error(`Missing required configuration: ${path}`);
    }

    return value;
  }
}
