import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Client as MinioClient } from 'minio';

import { ApplicationConfigService } from '../config/application-config.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;
  private readonly presignExpiry: number;

  constructor(config: ApplicationConfigService) {
    const storage = config.storage;
    this.bucket = storage.bucket;
    this.presignExpiry = storage.presignExpiry;

    this.client = new MinioClient({
      endPoint: storage.endpoint,
      port: storage.port,
      useSSL: storage.useSSL,
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
    });
  }

  // Đảm bảo bucket tồn tại khi app khởi động
  async onModuleInit(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket, '');
      this.logger.log(`Created bucket "${this.bucket}"`);
    } else {
      this.logger.log(`Bucket "${this.bucket}" ready`);
    }
  }

  /**
   * Cấp presigned PUT URL để client upload thẳng lên MinIO.
   * App không proxy file (bài học 03/07-docs: tránh bottleneck băng thông).
   */
  async createPresignedPutUrl(
    objectKey: string,
  ): Promise<{ url: string; expirySec: number }> {
    const url = await this.client.presignedPutObject(
      this.bucket,
      objectKey,
      this.presignExpiry,
    );
    return { url, expirySec: this.presignExpiry };
  }

  /** Lấy metadata object (size, contentType) — dùng ở bước confirm sau này. */
  async statObject(objectKey: string) {
    return this.client.statObject(this.bucket, objectKey);
  }

  /** Đọc N byte đầu của object (cho magic-bytes verify). */
  async readHead(objectKey: string, n: number): Promise<Buffer> {
    const stream = await this.client.getPartialObject(this.bucket, objectKey, 0, n);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).subarray(0, n);
  }

  getBucketName(): string {
    return this.bucket;
  }
}
