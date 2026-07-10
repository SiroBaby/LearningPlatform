import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './app.config';
import { ApplicationConfigService } from './application-config.service';
import databaseConfig from './database.config';
import storageConfig from './storage.config';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, storageConfig],
    }),
  ],
  providers: [ApplicationConfigService],
  exports: [ApplicationConfigService],
})
export class ApplicationConfigModule {}
