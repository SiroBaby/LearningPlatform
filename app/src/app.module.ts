import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from './config/application-config.module';
import { MappingModule } from './common/mapping/mapping.module';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { StorageModule } from './storage/storage.module';
import { ContentModule } from './modules/content/content.module';

@Module({
  imports: [
    ApplicationConfigModule,
    MappingModule,
    TypeOrmModule.forRootAsync({
      imports: [ApplicationConfigModule],
      useClass: TypeOrmConfigService,
    }),
    StorageModule,
    ContentModule,
  ],
})
export class AppModule {}
