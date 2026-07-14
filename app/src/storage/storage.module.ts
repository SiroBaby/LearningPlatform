import { Module, Global } from '@nestjs/common';
import { ApplicationConfigModule } from '../config/application-config.module';
import { StorageService } from './storage.service';
import { MinioStorageVerifier } from './minio-storage-verifier';
import { STORAGE_VERIFIER } from './contracts/storage-verifier.port';
import { STORAGE_OBJECT_READER } from './contracts/storage-object-reader.port';
import { MinioStorageObjectReader } from './minio-storage-object-reader.service';

// Global: nhiều module (content, ai sau này) đều cần storage
@Global()
@Module({
  imports: [ApplicationConfigModule],
  providers: [
    StorageService,
    MinioStorageObjectReader,
    { provide: STORAGE_VERIFIER, useClass: MinioStorageVerifier },
    { provide: STORAGE_OBJECT_READER, useExisting: MinioStorageObjectReader },
  ],
  exports: [StorageService, STORAGE_VERIFIER, STORAGE_OBJECT_READER],
})
export class StorageModule {}
