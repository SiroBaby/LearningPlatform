import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from '../config/application-config.module';
import { MappingModule } from '../common/mapping/mapping.module';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { AiModule } from '../modules/ai/ai.module';
import { ContentModule } from '../modules/content/content.module';
import { StorageModule } from '../storage/storage.module';
import { WorkerRunner } from './worker-runner.service';

@Module({
  imports: [
    ApplicationConfigModule,
    MappingModule,
    TypeOrmModule.forRootAsync({
      imports: [ApplicationConfigModule],
      useClass: TypeOrmConfigService,
    }),
    StorageModule,
    AiModule,
    ContentModule,
  ],
  providers: [WorkerRunner],
})
export class WorkerModule {}
