import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { ContentService } from './content.service';
import { DocumentPurgeManifest } from './entities/document-purge-manifest.entity';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { DocumentPurgeManifestStatus } from './enums/document-purge-manifest-status.enum';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';

describe('ContentService.delete', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let documents: Repository<Document>;
  let manifests: Repository<DocumentPurgeManifest>;
  let outbox: Repository<OutboxEvent>;
  let service: ContentService;
  let verifier: FakeStorageVerifier;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    documents = dataSource.getRepository(Document);
    manifests = dataSource.getRepository(DocumentPurgeManifest);
    outbox = dataSource.getRepository(OutboxEvent);
    verifier = new FakeStorageVerifier();
    service = new ContentService(
      new ContentRepository(dataSource),
      {
        getBucketName: (kind: 'documents' | 'media') => kind === 'media'
          ? 'learning-platform-dev-media'
          : 'learning-platform-dev-documents',
      } as never,
      verifier,
      null as never,
    );
    await db.client.query(
      'TRUNCATE "ai"."media_probe_results", "ai"."media_probe_jobs", "ai"."processing_jobs", "course"."document_probe_receipts", "course"."document_purge_manifests", "course"."documents", "course"."outbox" CASCADE',
    );
  });

  it('reads exact media metadata before deleting an unconfirmed upload', async () => {
    const document = await seedMediaDocument();

    const deleted = await service.delete(document.ownerId, document.id);

    const current = await documents.findOneByOrFail({ id: document.id });
    expect(deleted.status).toBe(DocumentStatus.DELETING);
    expect(current.status).toBe(DocumentStatus.DELETING);
    expect(Number(current.deletionFence)).toBe(1);
    expect(await manifests.countBy({ documentId: document.id })).toBe(1);
    await expect(manifests.findOneByOrFail({ documentId: document.id })).resolves.toMatchObject({
      status: DocumentPurgeManifestStatus.PENDING,
      locators: [{
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-1',
        etag: 'etag-1',
        contentLength: 1024,
      }],
    });
    expect(await outbox.countBy({ aggregateId: document.id, eventType: 'DocumentPurgeRequested' })).toBe(1);
    const persisted = await documents.findOneByOrFail({ id: document.id });
    expect(persisted).toMatchObject({
      mediaSourceBucket: 'learning-platform-dev-media',
      mediaSourceVersionId: 'version-1',
      mediaSourceEtag: 'etag-1',
    });
    expect(Number(persisted.mediaSourceContentLength)).toBe(1024);
  });

  it('leaves an unconfirmed media upload unchanged when HeadObject metadata is unavailable', async () => {
    const document = await seedMediaDocument();
    verifier.setResult({ exists: false, versionId: undefined, etag: undefined });

    await expect(service.delete(document.ownerId, document.id)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'DOCUMENT_PURGE_METADATA_UNAVAILABLE',
        retryable: true,
      },
    });
    const current = await documents.findOneByOrFail({ id: document.id });
    expect(current.status).toBe(DocumentStatus.UPLOADED);
    expect(Number(current.deletionFence)).toBe(0);
    expect(current.mediaSourceVersionId).toBeNull();
    expect(await manifests.countBy({ documentId: document.id })).toBe(0);
    expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
  });

  it('reads exact media metadata before deleting a legacy FAILED document without source identity', async () => {
    const document = await seedMediaDocument(undefined, DocumentStatus.FAILED);

    const deleted = await service.delete(document.ownerId, document.id);

    expect(deleted.status).toBe(DocumentStatus.DELETING);
    await expect(manifests.findOneByOrFail({ documentId: document.id })).resolves.toMatchObject({
      locators: [{
        bucket: 'learning-platform-dev-media',
        key: document.storageRef,
        versionId: 'version-1',
        etag: 'etag-1',
        contentLength: 1024,
      }],
    });
    await expect(documents.findOneByOrFail({ id: document.id })).resolves.toMatchObject({
      status: DocumentStatus.DELETING,
      mediaSourceBucket: 'learning-platform-dev-media',
      mediaSourceVersionId: 'version-1',
      mediaSourceEtag: 'etag-1',
    });
    expect(Number((await documents.findOneByOrFail({ id: document.id })).mediaSourceContentLength)).toBe(1024);
  });

  it('leaves a legacy FAILED media document unchanged when HeadObject metadata is unavailable', async () => {
    const document = await seedMediaDocument(undefined, DocumentStatus.FAILED);
    verifier.setResult({ exists: false, versionId: undefined, etag: undefined });

    await expect(service.delete(document.ownerId, document.id)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'DOCUMENT_PURGE_METADATA_UNAVAILABLE',
        retryable: true,
      },
    });
    await expect(documents.findOneByOrFail({ id: document.id })).resolves.toMatchObject({
      status: DocumentStatus.FAILED,
      mediaSourceBucket: null,
      mediaSourceVersionId: null,
      mediaSourceEtag: null,
      mediaSourceContentLength: null,
    });
    expect(Number((await documents.findOneByOrFail({ id: document.id })).deletionFence)).toBe(0);
    expect(await manifests.countBy({ documentId: document.id })).toBe(0);
    expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
  });

  it('returns an existing DELETING media document without re-reading storage metadata', async () => {
    const document = await seedMediaDocument(undefined, DocumentStatus.DELETING);
    verifier.setResult({ exists: false, versionId: undefined, etag: undefined });

    await expect(service.delete(document.ownerId, document.id)).resolves.toMatchObject({
      status: DocumentStatus.DELETING,
    });
    expect(verifier.verifyCalls).toBe(0);
    expect(await manifests.countBy({ documentId: document.id })).toBe(0);
    expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
  });

  it.each(['null', ' NULL ', 'NuLl'])('leaves an unconfirmed media upload unchanged when HeadObject returns placeholder VersionId %j', async (versionId) => {
    const document = await seedMediaDocument();
    verifier.setResult({ versionId });

    await expect(service.delete(document.ownerId, document.id)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'DOCUMENT_PURGE_METADATA_UNAVAILABLE',
        retryable: true,
      },
    });
    const current = await documents.findOneByOrFail({ id: document.id });
    expect(current.status).toBe(DocumentStatus.UPLOADED);
    expect(Number(current.deletionFence)).toBe(0);
    expect(await manifests.countBy({ documentId: document.id })).toBe(0);
    expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
  });

  it('does not query media metadata after confirmation has persisted the source identity', async () => {
    const document = await seedMediaDocument({ versionId: 'version-confirmed', etag: 'etag-confirmed' });
    verifier.setResult({ exists: false, versionId: undefined, etag: undefined });

    await expect(service.delete(document.ownerId, document.id)).resolves.toMatchObject({
      status: DocumentStatus.DELETING,
    });
    expect(await manifests.findOneByOrFail({ documentId: document.id })).toMatchObject({
      locators: [{
        versionId: 'version-confirmed',
        etag: 'etag-confirmed',
      }],
    });
  });

  it('does not query media metadata while a document is already processing', async () => {
    const document = await documents.save(documents.create({
      ownerId: randomUUID(),
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: `media/${randomUUID()}.mp4`,
      sizeBytes: 1024,
      status: DocumentStatus.PROCESSING,
      mediaSourceBucket: 'learning-platform-dev-media',
      mediaSourceVersionId: 'version-processing',
      mediaSourceEtag: 'etag-processing',
      mediaSourceContentLength: 1024,
    }));
    verifier.setResult({ exists: false, versionId: undefined, etag: undefined });

    await expect(service.delete(document.ownerId, document.id)).resolves.toMatchObject({
      status: DocumentStatus.DELETING,
    });
    expect(await manifests.findOneByOrFail({ documentId: document.id })).toMatchObject({
      locators: [{
        versionId: 'version-processing',
        etag: 'etag-processing',
      }],
    });
  });

  it('concurrent delete requests produce one exact manifest', async () => {
    const document = await seedMediaDocument({
      versionId: 'version-1',
      etag: 'etag-1',
    });
    await outbox.save(outbox.create({
      aggregateId: document.id,
      eventType: 'DocumentProbeRequested',
      payload: {
        documentId: document.id,
        jobType: 'MEDIA_PROBE',
        sourceBucket: 'learning-platform-dev-media',
        sourceKey: document.storageRef,
        sourceVersionId: 'version-1',
        sourceEtag: 'etag-1',
        sourceContentLength: document.sizeBytes,
      },
      publishedAt: null,
    }));

    const results = await Promise.all([
      service.delete(document.ownerId, document.id),
      service.delete(document.ownerId, document.id),
    ]);

    expect(results).toHaveLength(2);
    expect(await manifests.countBy({ documentId: document.id })).toBe(1);
    expect(await outbox.countBy({ aggregateId: document.id, eventType: 'DocumentPurgeRequested' })).toBe(1);
    const manifest = await manifests.findOneByOrFail({ documentId: document.id });
    expect(manifest.locators).toEqual([{
      bucket: 'learning-platform-dev-media',
      key: document.storageRef,
      versionId: 'version-1',
      etag: 'etag-1',
      contentLength: 1024,
    }]);
  });

  async function seedMediaDocument(
    locator?: { readonly versionId: string; readonly etag: string },
    status: DocumentStatus = DocumentStatus.UPLOADED,
  ): Promise<Document> {
    return documents.save(documents.create({
      ownerId: randomUUID(),
      type: DocumentType.VIDEO,
      originalName: 'lecture.mp4',
      storageRef: `media/${randomUUID()}.mp4`,
      sizeBytes: 1024,
      status,
      ...(locator && {
        mediaSourceBucket: 'learning-platform-dev-media',
        mediaSourceVersionId: locator.versionId,
        mediaSourceEtag: locator.etag,
        mediaSourceContentLength: 1024,
      }),
    }));
  }
});
