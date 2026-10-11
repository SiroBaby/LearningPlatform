import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './app.config';
import aiConfig from './ai.config';
import { ApplicationConfigService } from './application-config.service';
import databaseConfig from './database.config';
import documentPurgeConfig from './document-purge.config';
import storageConfig from './storage.config';
import workerConfig from './worker.config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [aiConfig, appConfig, databaseConfig, documentPurgeConfig, storageConfig, workerConfig],
    }),
  ],
  providers: [ApplicationConfigService],
  exports: [ApplicationConfigService],
})
export class ApplicationConfigModule {}
