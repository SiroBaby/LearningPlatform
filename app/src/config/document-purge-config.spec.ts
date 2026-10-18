import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from './application-config.service';

interface PurgeConfigOverrides {
  readonly environment?: string;
  readonly documentPurge?: Record<string, unknown>;
  readonly storage?: Record<string, unknown>;
}

function purgeConfig(overrides: PurgeConfigOverrides = {}): ApplicationConfigService {
  return new ApplicationConfigService(new ConfigService({
    app: { env: overrides.environment ?? 'development' },
    documentPurge: {
      accessKey: 'purge-access',
      backlogIntervalMs: 300_000,
      backoffBaseMs: 30_000,
      backoffMaxMs: 3_600_000,
      batchSize: 10,
      leaseMs: 300_000,
      maxAttempts: 8,
      pollIntervalMs: 5_000,
      secretKey: 'purge-secret',
      storageRequestTimeoutMs: 10_000,
      ...overrides.documentPurge,
    },
    storage: {
      accessKey: 'api-documents-access',
      bucket: 'documents',
      egressProxyUrl: 'http://media-egress-proxy:3128',
      endpoint: 's3.ap-southeast-1.amazonaws.com',
      mediaApiAccessKey: 'api-media-access',
      mediaBucket: 'media',
      port: 443,
      region: 'ap-southeast-1',
      secretKey: 'api-documents-secret',
      useSSL: true,
      ...overrides.storage,
    },
  }));
}

describe('ApplicationConfigService.documentPurge', () => {
  it('returns typed purge settings with the dedicated identity', () => {
    const settings = purgeConfig({ environment: 'production' }).documentPurge;

    expect(settings).toEqual({
      backlogIntervalMs: 300_000,
      backoffBaseMs: 30_000,
      backoffMaxMs: 3_600_000,
      batchSize: 10,
      documentsBucket: 'documents',
      leaseMs: 300_000,
      maxAttempts: 8,
      mediaBucket: 'media',
      pollIntervalMs: 5_000,
      storage: {
        accessKey: 'purge-access',
        egressProxyUrl: 'http://media-egress-proxy:3128',
        endpoint: 's3.ap-southeast-1.amazonaws.com',
        port: 443,
        region: 'ap-southeast-1',
        requestTimeoutMs: 10_000,
        secretKey: 'purge-secret',
        useSSL: true,
      },
    });
  });

  it.each([
    ['missing purge access key', { documentPurge: { accessKey: undefined } }, 'OBJECT_STORAGE_PURGE_ACCESS_KEY and OBJECT_STORAGE_PURGE_SECRET_KEY are required'],
    ['blank purge secret key', { documentPurge: { secretKey: ' ' } }, 'OBJECT_STORAGE_PURGE_ACCESS_KEY and OBJECT_STORAGE_PURGE_SECRET_KEY are required'],
    ['missing media bucket', { storage: { mediaBucket: undefined } }, 'OBJECT_STORAGE_MEDIA_BUCKET is required for the document purge worker'],
    ['same media and documents bucket', { storage: { mediaBucket: 'documents' } }, 'OBJECT_STORAGE_MEDIA_BUCKET must differ'],
    ['zero backlog interval', { documentPurge: { backlogIntervalMs: 0 } }, 'documentPurge.backlogIntervalMs must be a positive integer'],
    ['zero batch size', { documentPurge: { batchSize: 0 } }, 'documentPurge.batchSize must be a positive integer'],
    ['NaN max attempts', { documentPurge: { maxAttempts: Number.NaN } }, 'documentPurge.maxAttempts must be a positive integer'],
    ['backoff base above max', { documentPurge: { backoffBaseMs: 10_000, backoffMaxMs: 5_000 } }, 'DOCUMENT_PURGE_BACKOFF_BASE_MS must not exceed'],
    ['lease shorter than storage requests', { documentPurge: { leaseMs: 20_000 } }, 'DOCUMENT_PURGE_LEASE_MS must exceed 5 x DOCUMENT_PURGE_STORAGE_REQUEST_TIMEOUT_MS'],
    ['lease equal to one locator budget', { documentPurge: { leaseMs: 50_000 } }, 'DOCUMENT_PURGE_LEASE_MS must exceed 5 x DOCUMENT_PURGE_STORAGE_REQUEST_TIMEOUT_MS'],
    ['non-regional Amazon endpoint', { storage: { endpoint: 's3.amazonaws.com' } }, 'OBJECT_STORAGE_ENDPOINT must be the regional S3 endpoint'],
    ['dualstack Amazon endpoint', { storage: { endpoint: 's3.dualstack.ap-southeast-1.amazonaws.com' } }, 'OBJECT_STORAGE_ENDPOINT must be the regional S3 endpoint'],
    ['proxy with credentials', { storage: { egressProxyUrl: 'http://user:pass@proxy:3128' } }, 'OBJECT_STORAGE_EGRESS_PROXY_URL must be an absolute HTTP or HTTPS URL'],
  ])('fails fast on %s', (_name, overrides, message) => {
    expect(() => purgeConfig(overrides as PurgeConfigOverrides).documentPurge).toThrow(message);
  });

  it.each([
    ['without the egress proxy', { storage: { egressProxyUrl: undefined } }, 'OBJECT_STORAGE_EGRESS_PROXY_URL is required for the document purge worker in production'],
    ['reusing the API documents identity', { documentPurge: { accessKey: 'api-documents-access' } }, 'must be a dedicated purge identity'],
    ['reusing the API media identity', { documentPurge: { accessKey: 'api-media-access' } }, 'must be a dedicated purge identity'],
    ['with default MinIO credentials', { documentPurge: { accessKey: 'minioadmin' } }, 'must be a dedicated purge identity'],
    ['without TLS', { storage: { useSSL: false } }, 'OBJECT_STORAGE_USE_SSL must be true in production'],
  ])('rejects production %s', (_name, overrides, message) => {
    expect(() => purgeConfig({ ...overrides, environment: 'production' } as PurgeConfigOverrides).documentPurge)
      .toThrow(message);
  });

  it('accepts a lease just above one locator budget', () => {
    expect(purgeConfig({ documentPurge: { leaseMs: 50_001 } }).documentPurge.leaseMs).toBe(50_001);
  });

  it('allows a local MinIO endpoint without a proxy outside production', () => {
    const settings = purgeConfig({
      storage: { egressProxyUrl: undefined, endpoint: 'localhost', port: 9000, region: 'us-east-1', useSSL: false },
    }).documentPurge;

    expect(settings.storage).toMatchObject({ egressProxyUrl: undefined, endpoint: 'localhost', useSSL: false });
  });
});
