import { Module, Global } from '@nestjs/common';
import { ApplicationConfigModule } from '../config/application-config.module';
import { STORAGE_OBJECT_READER } from './contracts/storage-object-reader.port';
import { STORAGE_VERIFIER } from './contracts/storage-verifier.port';
import { ObjectStorageObjectReader } from './object-storage-object-reader.service';
import { ObjectStorageVerifier } from './object-storage-verifier';
import { StorageService } from './storage.service';

// Global: nhiều module (content, ai sau này) đều cần storage
@Global()
@Module({
  imports: [ApplicationConfigModule],
  providers: [
    StorageService,
    ObjectStorageObjectReader,
    { provide: STORAGE_VERIFIER, useClass: ObjectStorageVerifier },
    { provide: STORAGE_OBJECT_READER, useExisting: ObjectStorageObjectReader },
  ],
  exports: [StorageService, STORAGE_VERIFIER, STORAGE_OBJECT_READER],
})
export class StorageModule {}
