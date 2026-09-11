import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';

import { ApplicationConfigService } from '../config/application-config.service';
import type { StorageSettings } from '../config/configuration.types';
import type { StorageBucketKind } from './contracts/storage-bucket.port';
import { normalizeStorageVersionId } from './storage-version-id';

export type StorageObjectStat = {
  readonly contentType?: string;
  readonly etag?: string;
  readonly size: number;
  readonly versionId?: string;
};

type AsyncByteStream = AsyncIterable<Uint8Array> & {
  destroy?: () => void;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly clients: Readonly<Partial<Record<StorageBucketKind, S3Client>>>;
  private readonly buckets: Readonly<Partial<Record<StorageBucketKind, string>>>;
  private readonly presignExpiry: number;

  constructor(config: ApplicationConfigService) {
    const storage = config.storage;
    const buckets: Partial<Record<StorageBucketKind, string>> = { documents: storage.bucket };
    const clients: Partial<Record<StorageBucketKind, S3Client>> = {
      documents: this.createClient(storage.accessKey, storage.secretKey, storage),
    };
    if (storage.mediaEnabled && storage.mediaBucket) {
      if (!storage.mediaApiAccessKey || !storage.mediaApiSecretKey) {
        throw new Error('Dedicated media storage credentials are required when media uploads are enabled');
      }
      buckets.media = storage.mediaBucket;
      clients.media = this.createClient(storage.mediaApiAccessKey, storage.mediaApiSecretKey, storage);
    }
    this.clients = clients;
    this.buckets = buckets;
    this.presignExpiry = storage.presignExpiry;
  }

  private createClient(
    accessKey: string,
    secretKey: string,
    storage: StorageSettings,
  ): S3Client {
    const requestHandler = storage.egressProxyUrl
      ? new NodeHttpHandler({
        httpAgent: new HttpsProxyAgent(storage.egressProxyUrl),
        httpsAgent: new HttpsProxyAgent(storage.egressProxyUrl),
      })
      : undefined;
    return new S3Client({
      endpoint: `${storage.useSSL ? 'https' : 'http'}://${storage.endpoint}:${storage.port}`,
      forcePathStyle: true,
      region: storage.region,
      ...(requestHandler ? { requestHandler } : {}),
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      // API startup validates the existing document bucket only. Media bucket
      // provisioning and versioning are owned by IaC/capability checks so the
      // API identity does not need bucket-level versioning permissions.
      const bucket = this.getBucketName('documents');
      await this.clientForBucket('documents').send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket "${bucket}" ready`);
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
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<{ formFields: Record<string, string>; url: string; expirySec: number }> {
    const { fields, url } = await createPresignedPost(this.clientForBucket(bucketKind), {
      Bucket: this.getBucketName(bucketKind),
      Conditions: [['content-length-range', sizeBytes, sizeBytes]],
      Expires: this.presignExpiry,
      Fields: { 'Content-Type': contentType },
      Key: objectKey,
    });
    return { formFields: fields, url, expirySec: this.presignExpiry };
  }

  /** Lấy metadata object (size, contentType) — dùng ở bước confirm sau này. */
  async statObject(
    objectKey: string,
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<StorageObjectStat> {
    const response = await this.clientForBucket(bucketKind).send(new HeadObjectCommand({
      Bucket: this.getBucketName(bucketKind),
      Key: objectKey,
    }));
    const versionId = normalizeStorageVersionId(response.VersionId);
    return {
      contentType: response.ContentType,
      ...(response.ETag ? { etag: response.ETag } : {}),
      size: response.ContentLength ?? 0,
      ...(versionId ? { versionId } : {}),
    };
  }

  /** Đọc N byte đầu của object (cho magic-bytes verify). */
  async readHead(
    objectKey: string,
    n: number,
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<Buffer> {
    if (n <= 0) return Buffer.alloc(0);
    const response = await this.clientForBucket(bucketKind).send(new GetObjectCommand({
      Bucket: this.getBucketName(bucketKind),
      Key: objectKey,
      Range: `bytes=0-${n - 1}`,
    }));
    return this.readBody(response.Body, n);
  }

  /** Reads at most maxBytes plus one sentinel byte to keep worker memory bounded. */
  async readObject(
    objectKey: string,
    maxBytes: number,
    bucketKind: StorageBucketKind = 'documents',
  ): Promise<Buffer> {
    const response = await this.clientForBucket(bucketKind).send(new GetObjectCommand({
      Bucket: this.getBucketName(bucketKind),
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

  getBucketName(bucketKind: StorageBucketKind = 'documents'): string {
    const bucket = this.buckets[bucketKind];
    if (!bucket) {
      if (bucketKind === 'media') {
        throw new Error('Media uploads are not enabled');
      }
      throw new Error(`Object storage bucket is disabled: ${bucketKind}`);
    }
    return bucket;
  }

  private clientForBucket(bucketKind: StorageBucketKind): S3Client {
    this.getBucketName(bucketKind);
    const client = this.clients[bucketKind];
    if (!client) {
      throw new Error(`Object storage client is disabled: ${bucketKind}`);
    }
    return client;
  }
}
