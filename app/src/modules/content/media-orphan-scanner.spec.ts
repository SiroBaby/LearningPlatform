import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type { DocumentPurgeStorageConnection, MediaOrphanScannerSettings } from '../../config/configuration.types';
import { createDocumentPurgeS3Client } from '../../storage/object-storage-document-purger';
import { ObjectStorageMediaOrphanStore } from '../../storage/object-storage-media-orphan-store';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';
import {
  startTestObjectStorage,
  TEST_OBJECT_STORAGE_REGION,
  TEST_OBJECT_STORAGE_ROOT_PASSWORD,
  TEST_OBJECT_STORAGE_ROOT_USER,
  TestObjectStorage,
} from '../../test-support/test-object-storage';
import { clearDocumentFlowData } from '../../../test/support/test-database-cleanup';
import { DocumentPurgeLocator, DocumentPurgeManifest } from './entities/document-purge-manifest.entity';
import { Document } from './entities/document.entity';
import { DocumentPurgeManifestStatus } from './enums/document-purge-manifest-status.enum';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { MediaOrphanScannerService } from './media-orphan-scanner.service';
import { MediaOrphanReferenceRepository } from './repositories/media-orphan-reference.repository';

const MEDIA_BUCKET = 'orphan-media';
/** Objects are young for a moment; waiting this long makes a 500 ms minimum age elapse. */
const AGE_WAIT_MS = 1_200;
const SHORT_MIN_AGE_MS = 500;
const ONE_HOUR_MS = 3_600_000;

describe('MediaOrphanScannerService (PostgreSQL + MinIO)', () => {
  let db: TestDb;
  let objectStorage: TestObjectStorage;
  let dataSource: DataSource;
  let documents: Repository<Document>;
  let manifests: Repository<DocumentPurgeManifest>;
  let references: MediaOrphanReferenceRepository;

  beforeAll(async () => {
    [db, objectStorage] = await Promise.all([startTestDb(), startTestObjectStorage()]);
    await objectStorage.createBucket(MEDIA_BUCKET, 'Enabled');
    dataSource = await createTestDataSource(db.container);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await Promise.all([db?.stop(), objectStorage?.stop()]);
  });

  beforeEach(async () => {
    documents = dataSource.getRepository(Document);
    manifests = dataSource.getRepository(DocumentPurgeManifest);
    references = new MediaOrphanReferenceRepository(dataSource);
    await clearDocumentFlowData(db.client);
  });

  function connection(): DocumentPurgeStorageConnection {
    return {
      accessKey: TEST_OBJECT_STORAGE_ROOT_USER,
      egressProxyUrl: undefined,
      endpoint: objectStorage.host,
      port: objectStorage.port,
      region: TEST_OBJECT_STORAGE_REGION,
      requestTimeoutMs: 5_000,
      secretKey: TEST_OBJECT_STORAGE_ROOT_PASSWORD,
      useSSL: false,
    };
  }

  function scannerFor(overrides: Partial<MediaOrphanScannerSettings> = {}): MediaOrphanScannerService {
    const settings: MediaOrphanScannerSettings = {
      deleteDelayMs: 0,
      deleteEnabled: true,
      enabled: true,
      intervalMs: ONE_HOUR_MS,
      maxDeletesPerRun: 100,
      maxObjectsPerRun: 1_000,
      minAgeMs: SHORT_MIN_AGE_MS,
      pageSize: 100,
      ...overrides,
    };
    const config = {
      documentPurge: { mediaBucket: MEDIA_BUCKET },
      mediaOrphanScanner: settings,
    } as unknown as ApplicationConfigService;
    return new MediaOrphanScannerService(
      references,
      new ObjectStorageMediaOrphanStore(createDocumentPurgeS3Client(connection())),
      config,
    );
  }

  async function upload(key: string, body: string): Promise<string> {
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, body);
    if (!versionId) throw new Error('expected a versioned upload');
    return versionId;
  }

  function newKey(ownerId: string = randomUUID()): string {
    return `media/${ownerId}/${randomUUID()}.mp4`;
  }

  async function seedDocument(key: string, status: DocumentStatus): Promise<Document> {
    return documents.save(documents.create({
      originalName: 'lecture.mp4',
      ownerId: key.split('/')[1],
      sizeBytes: 5,
      status,
      storageRef: key,
      type: DocumentType.VIDEO,
    }));
  }

  async function seedManifest(
    documentId: string,
    status: DocumentPurgeManifestStatus,
    locators: readonly DocumentPurgeLocator[],
  ): Promise<void> {
    await manifests.save(manifests.create({
      deletionFence: 1,
      documentId,
      idempotencyKey: `document-purge:${documentId}:1`,
      locators: [...locators],
      ownerId: randomUUID(),
      status,
    }));
  }

  function locator(key: string, versionId: string): DocumentPurgeLocator {
    return { bucket: MEDIA_BUCKET, contentLength: 5, etag: 'etag', key, versionId };
  }

  async function waitUntilOld(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, AGE_WAIT_MS));
  }

  it('deletes a version uploaded after the purge finished (Q1) and nothing else', async () => {
    const key = newKey();
    // The purge already hard-deleted the manifest version; only the late upload is left.
    const purgedVersion = randomUUID();
    await upload(key, 'uploaded through a stale presigned URL');
    const document = await seedDocument(key, DocumentStatus.DELETING);
    await seedManifest(document.id, DocumentPurgeManifestStatus.COMPLETED, [locator(key, purgedVersion)]);
    await waitUntilOld();

    const report = await scannerFor().scanOnce();

    expect(report).toMatchObject({ completedPass: true, deletedCount: 1, outcome: 'COMPLETED' });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [],
    });
  });

  it('reports in dry-run without touching the bucket', async () => {
    const key = newKey();
    const versionId = await upload(key, 'orphan');
    await waitUntilOld();

    const report = await scannerFor({ deleteEnabled: false }).scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, mode: 'dry-run', orphanCount: 1 });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [versionId],
    });
  });

  it('keeps every version of a key an active Document references', async () => {
    const key = newKey();
    const firstVersion = await upload(key, 'one');
    const secondVersion = await upload(key, 'two');
    await seedDocument(key, DocumentStatus.READY);
    await waitUntilOld();

    const report = await scannerFor().scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, orphanCount: 0, skippedReferencedCount: 2 });
    const remaining = await objectStorage.listVersions(MEDIA_BUCKET, key);
    expect([...remaining.versionIds].sort()).toEqual([firstVersion, secondVersion].sort());
  });

  it('keeps a key whose DELETING tombstone still has an unfinished manifest', async () => {
    const key = newKey();
    const versionId = await upload(key, 'pending purge');
    const document = await seedDocument(key, DocumentStatus.DELETING);
    await seedManifest(document.id, DocumentPurgeManifestStatus.PENDING, [locator(key, versionId)]);
    await waitUntilOld();

    const report = await scannerFor().scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, skippedReferencedCount: 1 });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toMatchObject({ versionIds: [versionId] });
  });

  it('keeps the exact version a dead-lettered manifest still names, but not newer ones', async () => {
    const key = newKey();
    const namedVersion = await upload(key, 'named');
    const lateVersion = await upload(key, 'late');
    const document = await seedDocument(key, DocumentStatus.DELETING);
    await seedManifest(document.id, DocumentPurgeManifestStatus.DEAD_LETTER, [locator(key, namedVersion)]);
    await waitUntilOld();

    await scannerFor().scanOnce();

    const remaining = await objectStorage.listVersions(MEDIA_BUCKET, key);
    expect(remaining.versionIds).toEqual([namedVersion]);
    expect(remaining.versionIds).not.toContain(lateVersion);
  });

  it('skips young objects and keys outside the media document namespace', async () => {
    const youngKey = newKey();
    const strayKey = 'media/not-a-uuid.mp4';
    const otherKey = `documents/${randomUUID()}/${randomUUID()}.pdf`;
    await upload(strayKey, 'stray');
    await upload(otherKey, 'other prefix');
    await waitUntilOld();
    await upload(youngKey, 'young');

    const report = await scannerFor({ minAgeMs: ONE_HOUR_MS }).scanOnce();
    const secondReport = await scannerFor().scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, orphanCount: 0 });
    expect(secondReport.skippedOutOfScopeCount).toBeGreaterThanOrEqual(1);
    await expect(objectStorage.listVersions(MEDIA_BUCKET, strayKey)).resolves.toMatchObject({ versionIds: [expect.any(String)] });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, otherKey)).resolves.toMatchObject({ versionIds: [expect.any(String)] });
  });

  it('pages through the bucket and respects the delete cap across runs', async () => {
    const keys = Array.from({ length: 5 }, () => newKey());
    await Promise.all(keys.map((key) => upload(key, 'orphan')));
    await waitUntilOld();
    const scanner = scannerFor({ maxDeletesPerRun: 3, pageSize: 2 });

    const firstRun = await scanner.scanOnce();
    const secondRun = await scanner.scanOnce();

    expect(firstRun).toMatchObject({ completedPass: false, deletedCount: 3, truncated: true });
    expect(secondRun).toMatchObject({ completedPass: true, deletedCount: 2 });
    for (const key of keys) {
      await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toMatchObject({ versionIds: [] });
    }
  });

  it('lets only one runner hold the scan lock', async () => {
    const first = await references.tryAcquireScanLock();
    const second = await references.tryAcquireScanLock();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first?.release();
    const third = await references.tryAcquireScanLock();
    expect(third).not.toBeNull();
    await third?.release();
  });
});
