import { describe, expect, it } from '@jest/globals';

import type { DocumentPurgeStorageConnection } from '../config/configuration.types';
import { DocumentPurgeErrorCode } from '../modules/content/enums/document-purge-error-code.enum';
import { startFakeEgressProxy, startFakeS3Server } from '../test-support/fake-storage-network';
import { createDocumentPurgeS3Client } from './object-storage-document-purger';
import { ObjectStorageMediaOrphanStore } from './object-storage-media-orphan-store';

const LOOPBACK_HOST = '127.0.0.1';
const LIST_INPUT = { bucket: 'orphan-media', maxKeys: 10, prefix: 'media/' };

function connectionFor(overrides: Partial<DocumentPurgeStorageConnection>): DocumentPurgeStorageConnection {
  return {
    accessKey: 'purge-test',
    egressProxyUrl: undefined,
    endpoint: LOOPBACK_HOST,
    port: 9,
    region: 'us-east-1',
    requestTimeoutMs: 5_000,
    secretKey: 'purge-test-secret',
    useSSL: false,
    ...overrides,
  };
}

describe('ObjectStorageMediaOrphanStore', () => {
  it('maps a denied ListObjectVersions to ACCESS_DENIED (missing s3:ListBucketVersions)', async () => {
    const fakeS3 = await startFakeS3Server({ code: 'AccessDenied', status: 403 });
    const client = createDocumentPurgeS3Client(connectionFor({ port: fakeS3.port }));
    try {
      await expect(new ObjectStorageMediaOrphanStore(client).listObjectVersions(LIST_INPUT))
        .rejects.toMatchObject({ code: DocumentPurgeErrorCode.ACCESS_DENIED });
      expect(fakeS3.requests).toEqual(['GET /orphan-media/?max-keys=10&prefix=media%2F&versions=']);
    } finally {
      client.destroy();
      await fakeS3.stop();
    }
  });

  it('treats a proxy refusal as temporary, never as a permission verdict', async () => {
    const proxy = await startFakeEgressProxy({ forward: false });
    const client = createDocumentPurgeS3Client(connectionFor({ egressProxyUrl: proxy.url }));
    try {
      await expect(new ObjectStorageMediaOrphanStore(client).listObjectVersions(LIST_INPUT))
        .rejects.toMatchObject({ code: DocumentPurgeErrorCode.STORAGE_TEMPORARY });
    } finally {
      client.destroy();
      await proxy.stop();
    }
  });

  it('treats NoSuchVersion on delete as already deleted', async () => {
    const fakeS3 = await startFakeS3Server({ code: 'NoSuchVersion', status: 404 });
    const client = createDocumentPurgeS3Client(connectionFor({ port: fakeS3.port }));
    try {
      await expect(new ObjectStorageMediaOrphanStore(client)
        .deleteObjectVersion({ bucket: 'orphan-media', key: 'media/a/b.mp4', versionId: 'v1' }))
        .resolves.toBeUndefined();
      expect(fakeS3.requests).toEqual(['DELETE /orphan-media/media/a/b.mp4?versionId=v1&x-id=DeleteObject']);
    } finally {
      client.destroy();
      await fakeS3.stop();
    }
  });

  it('classifies a missing bucket on listing as CONFIGURATION', async () => {
    const fakeS3 = await startFakeS3Server({ code: 'NoSuchKey', status: 404 });
    const client = createDocumentPurgeS3Client(connectionFor({ port: fakeS3.port }));
    try {
      await expect(new ObjectStorageMediaOrphanStore(client).listObjectVersions(LIST_INPUT))
        .rejects.toMatchObject({ code: DocumentPurgeErrorCode.CONFIGURATION });
    } finally {
      client.destroy();
      await fakeS3.stop();
    }
  });
});
