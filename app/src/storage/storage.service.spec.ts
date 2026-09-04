import { S3Client } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from '../config/application-config.service';
import { StorageService } from './storage.service';

const mockCreatePresignedPost = jest.fn<(...args: unknown[]) => Promise<{
  fields: Record<string, string>;
  url: string;
}>>();
const mockSend = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockS3Client = jest.fn<(...args: unknown[]) => { send: typeof mockSend }>();

jest.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: jest.fn((input: unknown) => ({ commandName: 'GetObjectCommand', input })),
  HeadBucketCommand: jest.fn((input: unknown) => ({ commandName: 'HeadBucketCommand', input })),
  HeadObjectCommand: jest.fn((input: unknown) => ({ commandName: 'HeadObjectCommand', input })),
  S3Client: jest.fn((...args: unknown[]) => {
    mockS3Client(...args);
    return { send: mockSend };
  }),
}));

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: (...args: unknown[]) => mockCreatePresignedPost(...args),
}));

const createService = (): StorageService => new StorageService(
  new ApplicationConfigService(
    new ConfigService({
      app: { env: 'development' },
      storage: {
        accessKey: 'access-key',
        bucket: 'documents',
        endpoint: 'storage.internal',
        port: 9000,
        presignExpiry: 300,
        region: 'ap-southeast-1',
        secretKey: 'secret-key',
        useSSL: false,
      },
    }),
  ),
);

beforeEach(() => {
  mockCreatePresignedPost.mockReset();
  mockS3Client.mockReset();
  mockSend.mockReset();
});

describe('StorageService.onModuleInit', () => {
  it('checks the pre-created bucket at startup without creating it', async () => {
    mockSend.mockResolvedValue({});
    const service = createService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'http://storage.internal:9000',
      forcePathStyle: true,
    }));
    expect(mockSend).toHaveBeenCalledWith({
      commandName: 'HeadBucketCommand',
      input: { Bucket: 'documents' },
    });
  });

  it('throws a sanitized error when the configured bucket does not exist', async () => {
    mockSend.mockRejectedValue(new Error('NoSuchBucket: documents'));
    const service = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'Object storage bucket is unavailable or misconfigured',
    );
  });

  it('throws a sanitized error when bucket lookup fails', async () => {
    mockSend.mockRejectedValue(new Error('S3 AccessDenied: denied by IAM policy'));
    const service = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'Object storage bucket is unavailable or misconfigured',
    );
  });
});

describe('StorageService object-storage operations', () => {
  it('preserves exact object key, content type and size in a presigned POST', async () => {
    mockCreatePresignedPost.mockResolvedValue({
      fields: { 'Content-Type': 'application/pdf', key: 'owner/object.pdf' },
      url: 'http://storage.internal:9000/documents',
    });
    const service = createService();

    await expect(service.createPresignedPostUrl('owner/object.pdf', 'application/pdf', 22)).resolves.toEqual({
      expirySec: 300,
      formFields: { 'Content-Type': 'application/pdf', key: 'owner/object.pdf' },
      url: 'http://storage.internal:9000/documents',
    });
    expect(mockCreatePresignedPost).toHaveBeenCalledWith(expect.anything(), {
      Bucket: 'documents',
      Conditions: [['content-length-range', 22, 22]],
      Expires: 300,
      Fields: { 'Content-Type': 'application/pdf' },
      Key: 'owner/object.pdf',
    });
  });

  it('maps S3 object metadata to the storage contract', async () => {
    mockSend.mockResolvedValue({ ContentLength: 22, ContentType: 'application/pdf' });
    const service = createService();

    await expect(service.statObject('owner/object.pdf')).resolves.toEqual({
      contentType: 'application/pdf',
      size: 22,
    });
    expect(mockSend).toHaveBeenCalledWith({
      commandName: 'HeadObjectCommand',
      input: { Bucket: 'documents', Key: 'owner/object.pdf' },
    });
  });

  it('reads a bounded object stream and destroys it after a size breach', async () => {
    let destroyed = false;
    const body = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        yield Buffer.from('12345');
      },
      destroy(): void {
        destroyed = true;
      },
    };
    mockSend.mockResolvedValue({ Body: body });
    const service = createService();

    await expect(service.readObject('owner/object.txt', 4)).rejects.toThrow(
      'Storage object exceeds the configured extraction limit',
    );
    expect(destroyed).toBe(true);
  });
});
