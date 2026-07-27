import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ApplicationConfigService } from '../config/application-config.service';
import { StorageService } from './storage.service';

type MinioClientMock = {
  bucketExists: jest.MockedFunction<(bucketName: string) => Promise<boolean>>;
  makeBucket: jest.MockedFunction<(bucketName: string, region?: string) => Promise<void>>;
};

const bucketExists = jest.fn<(bucketName: string) => Promise<boolean>>();
const makeBucket = jest.fn<(bucketName: string, region?: string) => Promise<void>>();

jest.mock('minio', () => ({
  Client: jest.fn(() => ({
    bucketExists,
    makeBucket,
  } satisfies MinioClientMock)),
}));

describe('StorageService.onModuleInit', () => {
  beforeEach(() => {
    bucketExists.mockReset();
    makeBucket.mockReset();
  });

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

  it('checks the pre-created bucket at startup and does not create it', async () => {
    bucketExists.mockResolvedValue(true);
    const service = createService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(bucketExists).toHaveBeenCalledWith('documents');
    expect(makeBucket).not.toHaveBeenCalled();
  });

  it('throws a sanitized error when the configured bucket does not exist', async () => {
    bucketExists.mockResolvedValue(false);
    const service = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'Object storage bucket is unavailable or misconfigured',
    );
    expect(makeBucket).not.toHaveBeenCalled();
  });

  it('throws a sanitized error when bucket lookup fails', async () => {
    bucketExists.mockRejectedValue(new Error('S3 AccessDenied: denied by IAM policy'));
    const service = createService();

    await expect(service.onModuleInit()).rejects.toThrow(
      'Object storage bucket is unavailable or misconfigured',
    );
    expect(makeBucket).not.toHaveBeenCalled();
  });
});
