import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MappingModule } from '../common/mapping/mapping.module';
import { ApplicationConfigModule } from '../config/application-config.module';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { AiModule } from '../modules/ai/ai.module';
import { LlmProviderModule } from '../modules/ai/llm-provider.module';
import { AssessmentModule } from '../modules/assessment/assessment.module';
import { ContentModule } from '../modules/content/content.module';
import { StorageModule } from '../storage/storage.module';
import { ReturnRelay } from './return-relay.service';
import { WorkerHealthServer } from './worker-health-server.service';
import { LegacyWorkerRunner } from './legacy-worker-runner.service';

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
    AssessmentModule,
    ContentModule,
  ],
  providers: [LegacyWorkerRunner, ReturnRelay, WorkerHealthServer],
})
export class LegacyWorkerModule {}
