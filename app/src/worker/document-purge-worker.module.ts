import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from '../config/application-config.module';
import { ApplicationConfigService } from '../config/application-config.service';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { DOCUMENT_PURGE_STORAGE } from '../modules/content/contracts/document-purge-storage.port';
import type { DocumentPurgeStorage } from '../modules/content/contracts/document-purge-storage.port';
import { MEDIA_ORPHAN_STORAGE } from '../modules/content/contracts/media-orphan-storage.port';
import type { MediaOrphanStorage } from '../modules/content/contracts/media-orphan-storage.port';
import { DocumentPurgeService } from '../modules/content/document-purge.service';
import { MediaOrphanScannerService } from '../modules/content/media-orphan-scanner.service';
import { DocumentPurgeRepository } from '../modules/content/repositories/document-purge.repository';
import { MediaOrphanReferenceRepository } from '../modules/content/repositories/media-orphan-reference.repository';
import {
  createDocumentPurgeS3Client,
  ObjectStorageDocumentPurger,
} from '../storage/object-storage-document-purger';
import { ObjectStorageMediaOrphanStore } from '../storage/object-storage-media-orphan-store';
import { DocumentPurgeRunner } from './document-purge-runner.service';
import { MediaOrphanScannerRunner } from './media-orphan-scanner-runner.service';
import { WorkerHealthServer } from './worker-health-server.service';

/** One S3 client (egress proxy, no dualstack, pinned region) for purge and scanner. */
const DOCUMENT_PURGE_S3_CLIENT = Symbol('DOCUMENT_PURGE_S3_CLIENT');

/**
 * Composition root for the purge runtime. It owns only the purge identity:
 * no relays, no API storage credentials, no LLM provider. The media orphan
 * scanner runs here with the same identity and stays idle unless enabled.
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
    MediaOrphanReferenceRepository,
    MediaOrphanScannerRunner,
    MediaOrphanScannerService,
    WorkerHealthServer,
    {
      inject: [ApplicationConfigService],
      provide: DOCUMENT_PURGE_S3_CLIENT,
      useFactory: (config: ApplicationConfigService): S3Client =>
        createDocumentPurgeS3Client(config.documentPurge.storage),
    },
    {
      inject: [DOCUMENT_PURGE_S3_CLIENT],
      provide: DOCUMENT_PURGE_STORAGE,
      useFactory: (client: S3Client): DocumentPurgeStorage => new ObjectStorageDocumentPurger(client),
    },
    {
      inject: [DOCUMENT_PURGE_S3_CLIENT],
      provide: MEDIA_ORPHAN_STORAGE,
      useFactory: (client: S3Client): MediaOrphanStorage => new ObjectStorageMediaOrphanStore(client),
    },
  ],
})
export class DocumentPurgeWorkerModule {}
