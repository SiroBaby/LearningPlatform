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
      region: storage.region,
      useSSL: storage.useSSL,
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        throw new Error('Configured object-storage bucket does not exist');
      }
      this.logger.log(`Bucket "${this.bucket}" ready`);
    } catch (error) {
      const cause = error instanceof Error ? error : undefined;
      throw new Error('Object storage bucket is unavailable or misconfigured', cause ? { cause } : undefined);
    }
  }

  /**
   * Presigned POST policy enforces the exact object key, MIME type and size at
   * storage boundary before MinIO accepts user-controlled bytes.
   */
  async createPresignedPostUrl(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<{ formFields: Record<string, string>; url: string; expirySec: number }> {
    const policy = this.client.newPostPolicy();
    policy.setBucket(this.bucket);
    policy.setKey(objectKey);
    policy.setExpires(new Date(Date.now() + this.presignExpiry * 1000));
    policy.setContentType(contentType);
    policy.setContentLengthRange(sizeBytes, sizeBytes);
    const { formData, postURL } = await this.client.presignedPostPolicy(policy);
    return { formFields: formData, url: postURL, expirySec: this.presignExpiry };
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

  /** Reads at most maxBytes plus one sentinel byte to keep worker memory bounded. */
  async readObject(objectKey: string, maxBytes: number): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      receivedBytes += bytes.length;
      if (receivedBytes > maxBytes) {
        stream.destroy();
        throw new RangeError('Storage object exceeds the configured extraction limit');
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, receivedBytes);
  }

  getBucketName(): string {
    return this.bucket;
  }
}
