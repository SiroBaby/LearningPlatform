import { Injectable } from '@nestjs/common';

import { StorageObjectReader } from './contracts/storage-object-reader.port';
import { StorageService } from './storage.service';

@Injectable()
export class ObjectStorageObjectReader implements StorageObjectReader {
  constructor(private readonly storage: StorageService) {}

  async read(objectKey: string, maxBytes: number): Promise<Buffer> {
    return this.storage.readObject(objectKey, maxBytes);
  }
}
