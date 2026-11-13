import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from '../config/application-config.service';
import { MAX_PRESIGNED_GET_EXPIRES_SEC, StorageService } from './storage.service';

interface StorageFixtureOptions {
  readonly mediaEnabled: boolean;
  readonly port: number;
  readonly useSSL: boolean;
}

const createService = (options: StorageFixtureOptions): StorageService => new StorageService(
  new ApplicationConfigService(
    new ConfigService({
      app: { env: 'development' },
      storage: {
        accessKey: 'access-key',
        bucket: 'documents',
        mediaApiAccessKey: options.mediaEnabled ? 'media-access-key' : undefined,
        mediaApiSecretKey: options.mediaEnabled ? 'media-secret-key' : undefined,
        mediaBucket: 'media',
        mediaEnabled: options.mediaEnabled,
        egressProxyUrl: undefined,
        endpoint: 's3.ap-southeast-1.amazonaws.com',
        port: options.port,
        presignExpiry: 300,
        region: 'ap-southeast-1',
        secretKey: 'secret-key',
        useSSL: options.useSSL,
      },
    }),
  ),
);

const inputSigningDate = new Date('2026-09-04T00:00:00.000Z');
const inputRequest = {
  key: 'media/owner/lecture.mp4',
  versionId: 'version-1',
  responseContentType: 'video/mp4',
  expiresInSec: 14400,
  signingDate: inputSigningDate,
};

describe('StorageService.createPresignedGetUrl', () => {
  it('pins the exact version, lifetime and response content type', async () => {
    const service = createService({ mediaEnabled: true, port: 443, useSSL: true });

    const actualUrl = new URL(await service.createPresignedGetUrl(inputRequest, 'media'));

    expect(actualUrl.pathname).toBe('/media/media/owner/lecture.mp4');
    expect(actualUrl.searchParams.get('versionId')).toBe('version-1');
    expect(actualUrl.searchParams.get('X-Amz-Expires')).toBe('14400');
    expect(actualUrl.searchParams.get('X-Amz-Date')).toBe('20260904T000000Z');
    expect(actualUrl.searchParams.get('response-content-type')).toBe('video/mp4');
    expect(actualUrl.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    { port: 443, useSSL: true, forbidden: ':443' },
    { port: 80, useSSL: false, forbidden: ':80' },
  ])('does not leak the default port $port into the signed host', async ({ port, useSSL, forbidden }) => {
    const service = createService({ mediaEnabled: true, port, useSSL });

    const actualUrl = await service.createPresignedGetUrl(inputRequest, 'media');

    expect(new URL(actualUrl).host).not.toContain(forbidden);
    expect(actualUrl).not.toContain(`amazonaws.com${forbidden}`);
  });

  it('keeps a non-default port in the host', async () => {
    const service = createService({ mediaEnabled: true, port: 9000, useSSL: false });

    const actualUrl = new URL(await service.createPresignedGetUrl(inputRequest, 'media'));

    expect(actualUrl.host).toBe('s3.ap-southeast-1.amazonaws.com:9000');
  });

  it('accepts exactly 12 hours and rejects anything longer', async () => {
    const service = createService({ mediaEnabled: true, port: 443, useSSL: true });

    const actualUrl = await service.createPresignedGetUrl(
      { ...inputRequest, expiresInSec: MAX_PRESIGNED_GET_EXPIRES_SEC },
      'media',
    );

    expect(new URL(actualUrl).searchParams.get('X-Amz-Expires')).toBe('43200');
    await expect(service.createPresignedGetUrl(
      { ...inputRequest, expiresInSec: MAX_PRESIGNED_GET_EXPIRES_SEC + 1 },
      'media',
    )).rejects.toThrow(RangeError);
  });

  it('fails when the media bucket is disabled', async () => {
    const service = createService({ mediaEnabled: false, port: 443, useSSL: true });

    await expect(service.createPresignedGetUrl(inputRequest, 'media')).rejects.toThrow('Media uploads are not enabled');
  });
});
