import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from '../config/application-config.module';
import { MappingModule } from '../common/mapping/mapping.module';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { AiModule } from '../modules/ai/ai.module';
import { LlmProviderModule } from '../modules/ai/llm-provider.module';
import { ContentModule } from '../modules/content/content.module';
import { StorageModule } from '../storage/storage.module';
import { WorkerRunner } from './worker-runner.service';
import { ReturnRelay } from './return-relay.service';

@Module({
  imports: [
    ApplicationConfigModule,
    MappingModule,
    TypeOrmModule.forRootAsync({
      imports: [ApplicationConfigModule],
      useClass: TypeOrmConfigService,
    }),
    StorageModule,
    LlmProviderModule,
    AiModule,
    ContentModule,
  ],
  providers: [ReturnRelay, WorkerRunner],
})
export class WorkerModule {}
