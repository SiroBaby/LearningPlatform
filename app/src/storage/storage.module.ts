import { Module, Global } from '@nestjs/common';
import { ApplicationConfigModule } from '../config/application-config.module';
import { StorageService } from './storage.service';
import { MinioStorageVerifier } from './minio-storage-verifier';
import { STORAGE_VERIFIER } from './contracts/storage-verifier.port';

// Global: nhiều module (content, ai sau này) đều cần storage
@Global()
@Module({
  imports: [ApplicationConfigModule],
  providers: [
    StorageService,
    { provide: STORAGE_VERIFIER, useClass: MinioStorageVerifier },
  ],
  exports: [StorageService, STORAGE_VERIFIER],
})
export class StorageModule {}
