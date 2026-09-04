import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';

import { ApplicationConfigService } from '../config/application-config.service';

type StorageObjectStat = {
  readonly contentType?: string;
  readonly size: number;
};

type AsyncByteStream = AsyncIterable<Uint8Array> & {
  destroy?: () => void;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignExpiry: number;

  constructor(config: ApplicationConfigService) {
    const storage = config.storage;
    this.bucket = storage.bucket;
    this.presignExpiry = storage.presignExpiry;

    this.client = new S3Client({
      endpoint: `${storage.useSSL ? 'https' : 'http'}://${storage.endpoint}:${storage.port}`,
      forcePathStyle: true,
      region: storage.region,
      credentials: {
        accessKeyId: storage.accessKey,
        secretAccessKey: storage.secretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" ready`);
    } catch (error) {
      const cause = error instanceof Error ? error : undefined;
      const sanitizedError = new Error('Object storage bucket is unavailable or misconfigured');
      if (cause) {
        Object.defineProperty(sanitizedError, 'cause', { value: cause });
      }
      throw sanitizedError;
    }
  }

  /**
   * Presigned POST policy enforces the exact object key, MIME type and size at
   * storage boundary before the object-storage service accepts user-controlled bytes.
   */
  async createPresignedPostUrl(
    objectKey: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<{ formFields: Record<string, string>; url: string; expirySec: number }> {
    const { fields, url } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Conditions: [['content-length-range', sizeBytes, sizeBytes]],
      Expires: this.presignExpiry,
      Fields: { 'Content-Type': contentType },
      Key: objectKey,
    });
    return { formFields: fields, url, expirySec: this.presignExpiry };
  }

  /** Lấy metadata object (size, contentType) — dùng ở bước confirm sau này. */
  async statObject(objectKey: string): Promise<StorageObjectStat> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }));
    return {
      contentType: response.ContentType,
      size: response.ContentLength ?? 0,
    };
  }

  /** Đọc N byte đầu của object (cho magic-bytes verify). */
  async readHead(objectKey: string, n: number): Promise<Buffer> {
    if (n <= 0) return Buffer.alloc(0);
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Range: `bytes=0-${n - 1}`,
    }));
    return this.readBody(response.Body, n);
  }

  /** Reads at most maxBytes plus one sentinel byte to keep worker memory bounded. */
  async readObject(objectKey: string, maxBytes: number): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }));
    return this.readBody(response.Body, maxBytes);
  }

  private async readBody(body: unknown, maxBytes: number): Promise<Buffer> {
    if (
      !body
      || typeof body !== 'object'
      || !(Symbol.asyncIterator in body)
    ) {
      throw new Error('Object storage response body is unavailable');
    }

    const stream = body as AsyncByteStream;
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      receivedBytes += bytes.length;
      if (receivedBytes > maxBytes) {
        stream.destroy?.();
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
