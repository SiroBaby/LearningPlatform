import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from '../config/application-config.module';
import { ApplicationConfigService } from '../config/application-config.service';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { DOCUMENT_PURGE_STORAGE } from '../modules/content/contracts/document-purge-storage.port';
import type { DocumentPurgeStorage } from '../modules/content/contracts/document-purge-storage.port';
import { DocumentPurgeService } from '../modules/content/document-purge.service';
import { DocumentPurgeRepository } from '../modules/content/repositories/document-purge.repository';
import {
  createDocumentPurgeS3Client,
  ObjectStorageDocumentPurger,
} from '../storage/object-storage-document-purger';
import { DocumentPurgeRunner } from './document-purge-runner.service';
import { WorkerHealthServer } from './worker-health-server.service';

/**
 * Composition root for the purge runtime. It owns only the purge identity:
 * no relays, no API storage credentials, no LLM provider.
 */
@Module({
  imports: [
    ApplicationConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ApplicationConfigModule],
      useClass: TypeOrmConfigService,
    }),
  ],
  providers: [
    DocumentPurgeRepository,
    DocumentPurgeRunner,
    DocumentPurgeService,
    WorkerHealthServer,
    {
      inject: [ApplicationConfigService],
      provide: DOCUMENT_PURGE_STORAGE,
      useFactory: (config: ApplicationConfigService): DocumentPurgeStorage =>
        new ObjectStorageDocumentPurger(createDocumentPurgeS3Client(config.documentPurge.storage)),
    },
  ],
})
export class DocumentPurgeWorkerModule {}
