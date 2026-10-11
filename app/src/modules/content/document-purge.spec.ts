import { randomUUID } from 'crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type { DocumentPurgeSettings } from '../../config/configuration.types';
import {
  createDocumentPurgeS3Client,
  ObjectStorageDocumentPurger,
} from '../../storage/object-storage-document-purger';
import {
  FakeEgressProxy,
  FakeS3Server,
  startFakeEgressProxy,
  startFakeS3Server,
} from '../../test-support/fake-storage-network';
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
import { DocumentPurgeRunner } from '../../worker/document-purge-runner.service';
import {
  DocumentPurgeStorage,
  DocumentPurgeStorageError,
} from './contracts/document-purge-storage.port';
import { DocumentPurgeService } from './document-purge.service';
import {
  DocumentPurgeLocator,
  DocumentPurgeManifest,
} from './entities/document-purge-manifest.entity';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { DocumentPurgeErrorCode } from './enums/document-purge-error-code.enum';
import { DocumentPurgeManifestStatus } from './enums/document-purge-manifest-status.enum';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';
import { DocumentPurgeRepository } from './repositories/document-purge.repository';

const MEDIA_BUCKET = 'purge-media';
const DOCUMENTS_BUCKET = 'purge-documents';
const VERSIONED_DOCUMENTS_BUCKET = 'purge-documents-versioned';
const SUSPENDED_BUCKET = 'purge-media-suspended';
const UNVERSIONED_MEDIA_BUCKET = 'purge-media-unversioned';
const LEASE_MS = 60_000;
const NONEXISTENT_VERSION_ID = '00000000-0000-4000-8000-000000000000';

describe('DocumentPurgeService (PostgreSQL + MinIO)', () => {
  let db: TestDb;
  let objectStorage: TestObjectStorage;
  let dataSource: DataSource;
  let manifests: Repository<DocumentPurgeManifest>;
  let documents: Repository<Document>;
  let outbox: Repository<OutboxEvent>;
  let repository: DocumentPurgeRepository;
  const stoppables: Array<{ stop(): Promise<void> }> = [];

  beforeAll(async () => {
    [db, objectStorage] = await Promise.all([startTestDb(), startTestObjectStorage()]);
    await objectStorage.createBucket(MEDIA_BUCKET, 'Enabled');
    await objectStorage.createBucket(DOCUMENTS_BUCKET, 'Unversioned');
    await objectStorage.createBucket(VERSIONED_DOCUMENTS_BUCKET, 'Enabled');
    await objectStorage.createBucket(SUSPENDED_BUCKET, 'Suspended');
    await objectStorage.createBucket(UNVERSIONED_MEDIA_BUCKET, 'Unversioned');
    dataSource = await createTestDataSource(db.container);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await Promise.all([db?.stop(), objectStorage?.stop()]);
  });

  beforeEach(async () => {
    manifests = dataSource.getRepository(DocumentPurgeManifest);
    documents = dataSource.getRepository(Document);
    outbox = dataSource.getRepository(OutboxEvent);
    repository = new DocumentPurgeRepository(dataSource);
    await clearDocumentFlowData(db.client);
  });

  afterEach(async () => {
    await Promise.all(stoppables.splice(0).map((stoppable) => stoppable.stop()));
  });

  function settingsFor(overrides: Partial<DocumentPurgeSettings> = {}, storage: Partial<DocumentPurgeSettings['storage']> = {}): DocumentPurgeSettings {
    return {
      backoffBaseMs: 1_000,
      backoffMaxMs: 1_500,
      batchSize: 10,
      documentsBucket: DOCUMENTS_BUCKET,
      leaseMs: LEASE_MS,
      maxAttempts: 3,
      mediaBucket: MEDIA_BUCKET,
      pollIntervalMs: 1_000,
      ...overrides,
      storage: {
        accessKey: TEST_OBJECT_STORAGE_ROOT_USER,
        egressProxyUrl: undefined,
        endpoint: objectStorage.host,
        port: objectStorage.port,
        region: TEST_OBJECT_STORAGE_REGION,
        requestTimeoutMs: 5_000,
        secretKey: TEST_OBJECT_STORAGE_ROOT_PASSWORD,
        useSSL: false,
        ...storage,
      },
    };
  }

  function configFor(settings: DocumentPurgeSettings): ApplicationConfigService {
    return { documentPurge: settings } as unknown as ApplicationConfigService;
  }

  function purgerFor(settings: DocumentPurgeSettings): DocumentPurgeStorage {
    return new ObjectStorageDocumentPurger(createDocumentPurgeS3Client(settings.storage));
  }

  function serviceFor(settings: DocumentPurgeSettings = settingsFor()): DocumentPurgeService {
    return new DocumentPurgeService(repository, purgerFor(settings), configFor(settings));
  }

  async function useFakeS3(code: string | null, status: number): Promise<FakeS3Server> {
    const server = await startFakeS3Server({ code, status });
    stoppables.push(server);
    return server;
  }

  async function useProxy(forward: boolean): Promise<FakeEgressProxy> {
    const proxy = await startFakeEgressProxy({ forward });
    stoppables.push(proxy);
    return proxy;
  }

  async function seedManifest(
    locators: readonly DocumentPurgeLocator[],
    documentId: string = randomUUID(),
  ): Promise<DocumentPurgeManifest> {
    const ownerId = randomUUID();
    const manifest = await manifests.save(manifests.create({
      deletionFence: 1,
      documentId,
      idempotencyKey: `document-purge:${documentId}:1`,
      locators: [...locators],
      nextAttemptAt: new Date(Date.now() - 1_000),
      ownerId,
    }));
    await outbox.save(outbox.create({
      aggregateId: documentId,
      eventType: 'DocumentPurgeRequested',
      payload: { documentId, purgeManifestId: manifest.id, version: 1 },
      publishedAt: null,
    }));
    return manifest;
  }

  function mediaLocator(key: string, versionId: string): DocumentPurgeLocator {
    return { bucket: MEDIA_BUCKET, contentLength: 5, etag: 'etag', key, versionId };
  }

  async function purgeOutboxPublishedAt(documentId: string): Promise<Date | null> {
    const event = await outbox.findOneByOrFail({ aggregateId: documentId, eventType: 'DocumentPurgeRequested' });
    return event.publishedAt;
  }

  async function makeDue(manifestId: string): Promise<void> {
    await db.client.query(
      `UPDATE "course"."document_purge_manifests" SET "next_attempt_at" = now() - interval '1 second' WHERE "id" = $1`,
      [manifestId],
    );
  }

  async function expireLease(manifestId: string): Promise<void> {
    await db.client.query(
      `UPDATE "course"."document_purge_manifests" SET "lease_until" = now() - interval '1 second' WHERE "id" = $1`,
      [manifestId],
    );
  }

  it('hard-deletes only the manifest version without leaving a delete marker', async () => {
    const key = `media/${randomUUID()}/${randomUUID()}.mp4`;
    const firstVersion = await objectStorage.putObject(MEDIA_BUCKET, key, 'first');
    const secondVersion = await objectStorage.putObject(MEDIA_BUCKET, key, 'second');
    if (!firstVersion || !secondVersion) throw new Error('expected versioned uploads');
    const manifest = await seedManifest([mediaLocator(key, firstVersion)]);

    await expect(serviceFor().purgeDueManifests()).resolves.toBe(1);

    // Q1: the version created outside the manifest stays for the orphan scanner.
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [secondVersion],
    });
    const completed = await manifests.findOneByOrFail({ id: manifest.id });
    expect(completed).toMatchObject({
      attempts: 1,
      lastErrorCode: null,
      leaseId: null,
      leaseUntil: null,
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    expect(completed.purgedAt).toBeInstanceOf(Date);
    expect(completed.locators).toEqual([mediaLocator(key, firstVersion)]);
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeInstanceOf(Date);
  });

  it('dead-letters a manifest without locators instead of reporting it purged', async () => {
    // Deletion committed with locatorStatus PENDING: no version was proven.
    const fakeS3 = await useFakeS3('InternalError', 500);
    const settings = settingsFor({}, { endpoint: fakeS3.host, port: fakeS3.port });
    const manifest = await seedManifest([]);

    await expect(serviceFor(settings).purgeDueManifests()).resolves.toBe(1);

    const row = await manifests.findOneByOrFail({ id: manifest.id });
    expect(row).toMatchObject({
      attempts: 1,
      lastErrorCode: DocumentPurgeErrorCode.LOCATORS_UNRESOLVED,
      purgedAt: null,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    expect(row.deadLetteredAt).toBeInstanceOf(Date);
    expect(fakeS3.requests).toEqual([]);
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeInstanceOf(Date);
    await makeDue(manifest.id);
    await expect(repository.claimDue({ leaseMs: LEASE_MS, limit: 10 })).resolves.toEqual([]);
  });

  it('deletes a PDF by key on a documents bucket without versioning', async () => {
    const key = `${randomUUID()}/${randomUUID()}.pdf`;
    await objectStorage.putObject(DOCUMENTS_BUCKET, key, '%PDF-1.7');
    const manifest = await seedManifest([{
      bucket: DOCUMENTS_BUCKET, contentLength: 8, etag: null, key, versionId: null,
    }]);

    await serviceFor().purgeDueManifests();

    await expect(objectStorage.listVersions(DOCUMENTS_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [],
    });
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
  });

  it('dead-letters a locator without VersionId on a versioned bucket and keeps the bytes', async () => {
    const key = `${randomUUID()}/${randomUUID()}.pdf`;
    const versionId = await objectStorage.putObject(VERSIONED_DOCUMENTS_BUCKET, key, '%PDF-1.7');
    const manifest = await seedManifest([{
      bucket: VERSIONED_DOCUMENTS_BUCKET, contentLength: 8, etag: null, key, versionId: null,
    }]);

    await serviceFor(settingsFor({ documentsBucket: VERSIONED_DOCUMENTS_BUCKET })).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 1,
      lastErrorCode: DocumentPurgeErrorCode.UNVERSIONED_LOCATOR,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    await expect(objectStorage.listVersions(VERSIONED_DOCUMENTS_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [versionId],
    });
  });

  it('treats a missing version as already purged', async () => {
    const key = `media/${randomUUID()}/${randomUUID()}.mp3`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'audio');
    if (!versionId) throw new Error('expected versioned upload');
    const manifest = await seedManifest([
      mediaLocator(key, versionId),
      mediaLocator(key, NONEXISTENT_VERSION_ID),
      mediaLocator(`media/${randomUUID()}/${randomUUID()}.mp3`, NONEXISTENT_VERSION_ID),
    ]);

    await serviceFor().purgeDueManifests();
    // Deleting the same version again is still a success.
    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [],
    });
  });

  it('retries throttling with capped backoff, then dead-letters and never claims again', async () => {
    const fakeS3 = await useFakeS3('SlowDown', 503);
    const settings = settingsFor({}, { endpoint: fakeS3.host, port: fakeS3.port });
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);
    const delays: number[] = [];

    for (let attempt = 1; attempt <= settings.maxAttempts; attempt += 1) {
      await serviceFor(settings).purgeDueManifests();
      const [row] = await db.client.query<{ status: string; attempts: number; last_error_code: string; delay_ms: string }>(
        `SELECT "status", "attempts", "last_error_code",
                round(EXTRACT(EPOCH FROM ("next_attempt_at" - "updated_at")) * 1000) AS "delay_ms"
           FROM "course"."document_purge_manifests" WHERE "id" = $1`,
        [manifest.id],
      ).then((result) => result.rows);
      expect(row.attempts).toBe(attempt);
      if (attempt < settings.maxAttempts) {
        expect(row).toMatchObject({ last_error_code: DocumentPurgeErrorCode.STORAGE_TEMPORARY, status: 'FAILED' });
        delays.push(Number(row.delay_ms));
        await makeDue(manifest.id);
      } else {
        expect(row).toMatchObject({ last_error_code: DocumentPurgeErrorCode.ATTEMPTS_EXHAUSTED, status: 'DEAD_LETTER' });
      }
    }

    // base 1000 ms, doubled, capped at 1500 ms.
    expect(delays).toEqual([1_000, 1_500]);
    expect(fakeS3.requests).toHaveLength(settings.maxAttempts);
    await makeDue(manifest.id);
    await expect(repository.claimDue({ leaseMs: LEASE_MS, limit: 10 })).resolves.toEqual([]);
    const deadLettered = await manifests.findOneByOrFail({ id: manifest.id });
    expect(deadLettered.deadLetteredAt).toBeInstanceOf(Date);
    expect(deadLettered.lastErrorMessage).toBeNull();
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeInstanceOf(Date);
  });

  it('dead-letters AccessDenied immediately without retrying', async () => {
    const fakeS3 = await useFakeS3('AccessDenied', 403);
    const settings = settingsFor({}, { endpoint: fakeS3.host, port: fakeS3.port });
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);

    await serviceFor(settings).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 1,
      lastErrorCode: DocumentPurgeErrorCode.ACCESS_DENIED,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    expect(fakeS3.requests).toHaveLength(1);
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeInstanceOf(Date);
  });

  it('retries a bare 404 without an S3 error code instead of treating it as deleted', async () => {
    const gateway = await useFakeS3(null, 404);
    const settings = settingsFor({}, { endpoint: gateway.host, port: gateway.port });
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);

    await serviceFor(settings).purgeDueManifests();

    const row = await manifests.findOneByOrFail({ id: manifest.id });
    expect(row).toMatchObject({
      attempts: 1,
      lastErrorCode: DocumentPurgeErrorCode.STORAGE_TEMPORARY,
      purgedAt: null,
      status: DocumentPurgeManifestStatus.FAILED,
    });
    expect(gateway.requests).toHaveLength(1);
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeNull();
  });

  it('dead-letters NoSuchBucket as a configuration error', async () => {
    const fakeS3 = await useFakeS3('NoSuchBucket', 404);
    const settings = settingsFor({}, { endpoint: fakeS3.host, port: fakeS3.port });
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);

    await serviceFor(settings).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      lastErrorCode: DocumentPurgeErrorCode.CONFIGURATION,
      purgedAt: null,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
  });

  it('retries with a cap when the egress proxy refuses the tunnel (Squid 403 page, no S3 code)', async () => {
    const proxy = await useProxy(false);
    const settings = settingsFor({ maxAttempts: 2 }, { egressProxyUrl: proxy.url });
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);

    await serviceFor(settings).purgeDueManifests();
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 1,
      lastErrorCode: DocumentPurgeErrorCode.STORAGE_TEMPORARY,
      status: DocumentPurgeManifestStatus.FAILED,
    });

    await makeDue(manifest.id);
    await serviceFor(settings).purgeDueManifests();
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 2,
      lastErrorCode: DocumentPurgeErrorCode.ATTEMPTS_EXHAUSTED,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    expect(proxy.connectTargets).toHaveLength(2);
  });

  it('dead-letters a rejected purge credential against real storage', async () => {
    const key = `media/${randomUUID()}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'bytes');
    if (!versionId) throw new Error('expected versioned upload');
    const manifest = await seedManifest([mediaLocator(key, versionId)]);

    await serviceFor(settingsFor({}, { secretKey: 'wrong-secret' })).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      lastErrorCode: DocumentPurgeErrorCode.ACCESS_DENIED,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [versionId],
    });
  });

  it('dead-letters a locator outside the configured buckets', async () => {
    const manifest = await seedManifest([{
      bucket: 'someone-else', contentLength: 1, etag: null, key: 'x', versionId: randomUUID(),
    }]);

    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      lastErrorCode: DocumentPurgeErrorCode.CONFIGURATION,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
  });

  it('purges from the manifest after the Document row was removed', async () => {
    const ownerId = randomUUID();
    const key = `media/${ownerId}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'video');
    if (!versionId) throw new Error('expected versioned upload');
    const document = await documents.save(documents.create({
      mediaSourceBucket: MEDIA_BUCKET,
      mediaSourceContentLength: 1024,
      mediaSourceEtag: 'etag-1',
      mediaSourceVersionId: versionId,
      originalName: 'lecture.mp4',
      ownerId,
      sizeBytes: 1024,
      status: DocumentStatus.UPLOADED,
      storageRef: key,
      type: DocumentType.VIDEO,
    }));
    await new ContentRepository(dataSource).deleteOwnedDocument(
      ownerId,
      document.id,
      { documents: DOCUMENTS_BUCKET, media: MEDIA_BUCKET },
      undefined,
      new Date(Date.now() + 60_000),
    );
    const manifest = await manifests.findOneByOrFail({ documentId: document.id });
    // Not due yet: presigned uploads issued before deletion may still land.
    await expect(serviceFor().purgeDueManifests()).resolves.toBe(0);
    await documents.delete({ id: document.id });
    await makeDue(manifest.id);

    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [],
    });
    expect(await purgeOutboxPublishedAt(document.id)).toBeInstanceOf(Date);
  });

  it('dead-letters and keeps the object when another live Document references the key', async () => {
    const ownerId = randomUUID();
    const key = `media/${ownerId}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'shared');
    if (!versionId) throw new Error('expected versioned upload');
    await documents.save(documents.create({
      originalName: 'other.mp4',
      ownerId,
      sizeBytes: 6,
      status: DocumentStatus.READY,
      storageRef: key,
      type: DocumentType.VIDEO,
    }));
    const manifest = await seedManifest([mediaLocator(key, versionId)]);

    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      lastErrorCode: DocumentPurgeErrorCode.ACTIVE_REFERENCE,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [versionId],
    });
  });

  it('ignores references from Documents that are themselves being deleted', async () => {
    const ownerId = randomUUID();
    const key = `media/${ownerId}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'shared');
    if (!versionId) throw new Error('expected versioned upload');
    await documents.save(documents.create({
      originalName: 'other.mp4',
      ownerId,
      sizeBytes: 6,
      status: DocumentStatus.DELETING,
      storageRef: key,
      type: DocumentType.VIDEO,
    }));
    const manifest = await seedManifest([mediaLocator(key, versionId)]);

    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
  });

  it('reclaims after a crashed worker lease expires and rejects every write with the stale lease', async () => {
    const key = `media/${randomUUID()}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'crash');
    if (!versionId) throw new Error('expected versioned upload');
    const manifest = await seedManifest([mediaLocator(key, versionId)]);

    // Worker A claims, then its pod dies before writing anything.
    const [crashed] = await repository.claimDue({ leaseMs: LEASE_MS, limit: 1 });
    await expect(repository.claimDue({ leaseMs: LEASE_MS, limit: 1 })).resolves.toEqual([]);
    await expireLease(manifest.id);

    // Worker B reclaims with a new lease while worker A is still alive somewhere.
    const [reclaimed] = await repository.claimDue({ leaseMs: LEASE_MS, limit: 1 });
    expect(reclaimed.id).toBe(manifest.id);
    expect(reclaimed.leaseId).not.toBe(crashed.leaseId);
    expect(reclaimed.attempts).toBe(2);

    await expect(repository.complete(manifest.id, crashed.leaseId)).resolves.toBe(false);
    await expect(repository.scheduleRetry({
      delayMs: 1_000,
      errorCode: DocumentPurgeErrorCode.STORAGE_TEMPORARY,
      id: manifest.id,
      leaseId: crashed.leaseId,
    })).resolves.toBe(false);
    await expect(repository.deadLetter({
      errorCode: DocumentPurgeErrorCode.ACCESS_DENIED,
      id: manifest.id,
      leaseId: crashed.leaseId,
    })).resolves.toBe(false);
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      leaseId: reclaimed.leaseId,
      status: DocumentPurgeManifestStatus.RUNNING,
    });
    expect(await purgeOutboxPublishedAt(manifest.documentId)).toBeNull();

    // Worker B also dies; the next worker finishes idempotently.
    await expireLease(manifest.id);
    await serviceFor().purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 3,
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
      deleteMarkerCount: 0,
      versionIds: [],
    });
  });

  it('rejects a stale lease even before anyone reclaims it', async () => {
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);
    const [claimed] = await repository.claimDue({ leaseMs: LEASE_MS, limit: 1 });
    await expireLease(manifest.id);

    await expect(repository.complete(manifest.id, claimed.leaseId)).resolves.toBe(false);
    await expect(repository.renewLease({ id: manifest.id, leaseId: claimed.leaseId, leaseMs: LEASE_MS }))
      .resolves.toBe(false);
  });

  it('renews the lease before every locator so a long manifest still completes', async () => {
    const keys = [0, 1, 2].map((index) => `media/${randomUUID()}/${index}.mp4`);
    const locators: DocumentPurgeLocator[] = [];
    for (const key of keys) {
      const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, key);
      if (!versionId) throw new Error('expected versioned upload');
      locators.push(mediaLocator(key, versionId));
    }
    const manifest = await seedManifest(locators);
    const settings = settingsFor();
    const purger = purgerFor(settings);
    // Each locator uses 60% of the lease, so three of them outlive one lease.
    const slowStorage: DocumentPurgeStorage = {
      deleteObject: (target) => purger.deleteObject(target),
      deleteObjectVersion: async (target) => {
        await purger.deleteObjectVersion(target);
        await db.client.query(
          `UPDATE "course"."document_purge_manifests"
              SET "lease_until" = "lease_until" - ($2::bigint * interval '1 millisecond')
            WHERE "id" = $1`,
          [manifest.id, LEASE_MS * 0.6],
        );
      },
      getBucketVersioning: (bucket) => purger.getBucketVersioning(bucket),
    };

    await new DocumentPurgeService(repository, slowStorage, configFor(settings)).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 1,
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    for (const key of keys) {
      await expect(objectStorage.listVersions(MEDIA_BUCKET, key)).resolves.toEqual({
        deleteMarkerCount: 0,
        versionIds: [],
      });
    }
  });

  it('stops deleting further locators once another worker took the lease', async () => {
    const keys = [0, 1].map((index) => `media/${randomUUID()}/${index}.mp4`);
    const locators: DocumentPurgeLocator[] = [];
    for (const key of keys) {
      const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, key);
      if (!versionId) throw new Error('expected versioned upload');
      locators.push(mediaLocator(key, versionId));
    }
    const manifest = await seedManifest(locators);
    const settings = settingsFor();
    const purger = purgerFor(settings);
    let reclaimedLeaseId: string | undefined;
    const stalledStorage: DocumentPurgeStorage = {
      deleteObject: (target) => purger.deleteObject(target),
      deleteObjectVersion: async (target) => {
        await purger.deleteObjectVersion(target);
        // This worker stalls past its lease; another worker reclaims.
        await expireLease(manifest.id);
        [{ leaseId: reclaimedLeaseId }] = await repository.claimDue({ leaseMs: LEASE_MS, limit: 1 });
      },
      getBucketVersioning: (bucket) => purger.getBucketVersioning(bucket),
    };

    await new DocumentPurgeService(repository, stalledStorage, configFor(settings)).purgeDueManifests();

    await expect(objectStorage.listVersions(MEDIA_BUCKET, keys[0])).resolves.toMatchObject({ versionIds: [] });
    await expect(objectStorage.listVersions(MEDIA_BUCKET, keys[1])).resolves.toMatchObject({
      versionIds: [locators[1].versionId],
    });
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      leaseId: reclaimedLeaseId,
      status: DocumentPurgeManifestStatus.RUNNING,
    });
  });

  it('dead-letters a manifest whose workers kept crashing past the attempt cap', async () => {
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);
    const settings = settingsFor({ maxAttempts: 2 });
    for (let crash = 0; crash < settings.maxAttempts; crash += 1) {
      await repository.claimDue({ leaseMs: LEASE_MS, limit: 1 });
      await expireLease(manifest.id);
    }

    await serviceFor(settings).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 3,
      lastErrorCode: DocumentPurgeErrorCode.ATTEMPTS_EXHAUSTED,
      status: DocumentPurgeManifestStatus.DEAD_LETTER,
    });
  });

  it('skips a manifest another worker is claiming instead of claiming it twice', async () => {
    const first = await seedManifest([mediaLocator('media/a/1.mp4', randomUUID())]);
    const second = await seedManifest([mediaLocator('media/a/2.mp4', randomUUID())]);
    const otherWorker = dataSource.createQueryRunner();
    await otherWorker.connect();
    try {
      // Worker A is inside its claim transaction and holds the first row lock.
      await otherWorker.startTransaction();
      await otherWorker.query(
        'SELECT "id" FROM "course"."document_purge_manifests" WHERE "id" = $1 FOR UPDATE',
        [first.id],
      );

      // Worker B does not wait for the lock and never sees the locked row.
      const claimedByB = await repository.claimDue({ leaseMs: LEASE_MS, limit: 10 });
      expect(claimedByB.map((manifest) => manifest.id)).toEqual([second.id]);

      await otherWorker.commitTransaction();
    } finally {
      if (otherWorker.isTransactionActive) await otherWorker.rollbackTransaction();
      await otherWorker.release();
    }

    const claimedLater = await repository.claimDue({ leaseMs: LEASE_MS, limit: 10 });
    expect(claimedLater.map((manifest) => manifest.id)).toEqual([first.id]);
    await expect(repository.claimDue({ leaseMs: LEASE_MS, limit: 10 })).resolves.toEqual([]);
  });

  it('lets concurrent workers finish every manifest exactly once', async () => {
    const seeded: DocumentPurgeManifest[] = [];
    for (let index = 0; index < 6; index += 1) {
      const key = `media/${randomUUID()}/${index}.mp4`;
      const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, `v${index}`);
      if (!versionId) throw new Error('expected versioned upload');
      seeded.push(await seedManifest([mediaLocator(key, versionId)]));
    }
    const settings = settingsFor({ batchSize: 6 });

    const processed = await Promise.all([serviceFor(settings).purgeDueManifests(), serviceFor(settings).purgeDueManifests()]);

    expect(processed[0] + processed[1]).toBe(seeded.length);
    const rows = await manifests.findBy(seeded.map((manifest) => ({ id: manifest.id })));
    expect(rows.map((row) => [row.status, row.attempts])).toEqual(
      seeded.map(() => [DocumentPurgeManifestStatus.COMPLETED, 1]),
    );
  });

  it('fails closed at startup unless media bucket versioning is Enabled', async () => {
    await expect(serviceFor().assertMediaBucketVersioned()).resolves.toBeUndefined();
    for (const mediaBucket of [SUSPENDED_BUCKET, UNVERSIONED_MEDIA_BUCKET]) {
      const settings = settingsFor({ mediaBucket });
      const runner = new DocumentPurgeRunner(configFor(settings), serviceFor(settings));
      await expect(runner.onModuleInit()).rejects.toThrow(
        'Media bucket versioning must be Enabled before document purge can start',
      );
      await runner.onApplicationShutdown();
    }
    const manifest = await seedManifest([mediaLocator('media/a/b.mp4', randomUUID())]);
    // Startup stopped before any purge cycle ran.
    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      attempts: 0,
      status: DocumentPurgeManifestStatus.PENDING,
    });
  });

  it('sends every storage request through the egress proxy to the configured host', async () => {
    const proxy = await useProxy(true);
    const key = `media/${randomUUID()}/${randomUUID()}.mp4`;
    const versionId = await objectStorage.putObject(MEDIA_BUCKET, key, 'proxied');
    if (!versionId) throw new Error('expected versioned upload');
    const manifest = await seedManifest([mediaLocator(key, versionId)]);
    const settings = settingsFor({}, { egressProxyUrl: proxy.url });

    await serviceFor(settings).assertMediaBucketVersioned();
    await serviceFor(settings).purgeDueManifests();

    await expect(manifests.findOneByOrFail({ id: manifest.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.COMPLETED,
    });
    expect(proxy.connectTargets.length).toBeGreaterThanOrEqual(2);
    expect(new Set(proxy.connectTargets)).toEqual(new Set([`${objectStorage.host}:${objectStorage.port}`]));
  });

  it('keeps the regional Amazon host behind the proxy (no dualstack or acceleration)', async () => {
    const proxy = await useProxy(false);
    const settings = settingsFor({}, {
      egressProxyUrl: proxy.url,
      endpoint: 's3.ap-southeast-1.amazonaws.com',
      port: 443,
      region: 'ap-southeast-1',
      useSSL: true,
    });
    const purger = purgerFor(settings);

    // The fake proxy refuses the tunnel like Squid does for a host outside
    // its allowlist; no request ever leaves this machine.
    await expect(purger.getBucketVersioning(MEDIA_BUCKET)).rejects.toBeInstanceOf(DocumentPurgeStorageError);
    await expect(purger.deleteObjectVersion({ bucket: MEDIA_BUCKET, key: 'media/a/b.mp4', versionId: 'v1' }))
      .rejects.toBeInstanceOf(DocumentPurgeStorageError);

    expect(proxy.connectTargets).toEqual([
      's3.ap-southeast-1.amazonaws.com:443',
      's3.ap-southeast-1.amazonaws.com:443',
    ]);
  });
});
