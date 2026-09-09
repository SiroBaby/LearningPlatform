import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { startTestDb, TestDb } from '../../test-support/test-db';
import { createTestDataSource } from '../../test-support/test-data-source';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { ContentService } from './content.service';
import { MAX_MP3_SIZE_BYTES } from './contracts/document-upload-policy';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { OutboxEvent } from './entities/outbox-event.entity';
import { ContentRepository } from './repositories/content.repository';

describe('ContentService.confirm', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let service: ContentService;
  let documents: Repository<Document>;
  let outbox: Repository<OutboxEvent>;
  let verifier: FakeStorageVerifier;
  let storage: { getBucketName: (bucketKind: 'documents' | 'media') => string };

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    if (db) {
      await db.stop();
    }
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    documents = dataSource.getRepository(Document);
    outbox = dataSource.getRepository(OutboxEvent);
    verifier = new FakeStorageVerifier();
    storage = {
      getBucketName: (bucketKind) => bucketKind === 'media' ? 'learning-platform-dev-media-custom' : 'learning-platform-dev-documents',
    };
    service = new ContentService(
      new ContentRepository(dataSource),
      storage as never,
      verifier,
      null as never,
    );
    await db.client.query('TRUNCATE "course"."documents", "course"."outbox"');
  });

  async function seedUploaded(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        ownerId,
        type: DocumentType.PDF,
        originalName: 'bai-giang.pdf',
        storageRef: `${ownerId}/${randomUUID()}.pdf`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );
  }

  async function seedRetryableFailure(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
        errorMessage: 'Document processing is temporarily unavailable. Please try again later.',
        ownerId,
        originalName: 'bai-giang.pdf',
        sizeBytes: 1024,
        status: DocumentStatus.FAILED,
        storageRef: `${ownerId}/${randomUUID()}.pdf`,
        type: DocumentType.PDF,
      }),
    );
  }

  async function seedUploadedMedia(ownerId: string): Promise<Document> {
    return documents.save(
      documents.create({
        ownerId,
        type: DocumentType.AUDIO,
        originalName: 'lecture.mp3',
        storageRef: `${ownerId}/${randomUUID()}.mp3`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );
  }

  it('chuyển UPLOADED -> PROCESSING và ghi đúng 1 outbox row', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);

    await service.confirm(owner, doc.id);

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.PROCESSING);

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('DocumentReadyForProcessing');
    // owner_id truyền qua data plane (ADR-0018)
    expect(rows[0].payload.ownerId).toBe(owner);
  });

  it('idempotent: confirm 2 lần chỉ tạo 1 outbox row (CAS, ADR-0005)', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);

    await service.confirm(owner, doc.id);
    await service.confirm(owner, doc.id);

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
  });

  it('retry CAS: concurrent submissions start one processing attempt only', async () => {
    const owner = randomUUID();
    const doc = await seedRetryableFailure(owner);
    const repository = new ContentRepository(dataSource);
    const selection = {
      customModelConfigId: null,
      kind: 'PLAN' as const,
      platformModelId: 'platform-default',
    };

    const results = await Promise.all([
      repository.retryProcessing(owner, doc.id, selection),
      repository.retryProcessing(owner, doc.id, selection),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(1);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.PROCESSING);
  });

  it('ownership: owner khác -> 404, không đổi status, không ghi outbox', async () => {
    const owner = randomUUID();
    const stranger = randomUUID();
    const doc = await seedUploaded(owner);

    await expect(service.confirm(stranger, doc.id)).rejects.toMatchObject({
      status: 404,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(0);
  });

  it('verify fail (magic bytes sai) -> reject, status không đổi', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);
    verifier.setResult({ magicBytesValid: false });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({
      status: 400,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
  });

  it('verify fail (object size khác declared size) -> reject, status không đổi', async () => {
    const owner = randomUUID();
    const doc = await seedUploaded(owner);
    verifier.setResult({ sizeBytes: 1025 });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({
      status: 400,
    });

    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
  });

  it('confirm media chuyển UPLOADED -> PROBING và ghi một probe outbox', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);

    const confirmed = await service.confirm(owner, doc.id);

    expect(confirmed.status).toBe(DocumentStatus.PROBING);
    expect(verifier.lastBucketKind).toBe('media');
    const reloaded = await documents.findOneByOrFail({ id: doc.id });
    expect(reloaded.status).toBe(DocumentStatus.PROBING);
    expect(reloaded.probeGeneration).toEqual(expect.any(String));
    expect(reloaded.probePolicyVersion).toBe('media-v1');

    const rows = await outbox.find({ where: { aggregateId: doc.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('DocumentProbeRequested');
    expect(rows[0].payload).toMatchObject({
      documentId: doc.id,
      jobType: 'MEDIA_PROBE',
      ownerId: owner,
      policyVersion: 'media-v1',
      probeGeneration: reloaded.probeGeneration,
      sourceBucket: 'learning-platform-dev-media-custom',
    });
  });

  it('confirm media lặp lại là no-op, không tạo probe outbox thứ hai', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);

    await service.confirm(owner, doc.id);
    const first = await documents.findOneByOrFail({ id: doc.id });
    await service.confirm(owner, doc.id);

    const second = await documents.findOneByOrFail({ id: doc.id });
    expect(second.status).toBe(DocumentStatus.PROBING);
    expect(second.probeGeneration).toBe(first.probeGeneration);
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(1);
  });

  it('confirm media video verifies the physical media bucket before probing', async () => {
    const owner = randomUUID();
    const doc = await documents.save(
      documents.create({
        ownerId: owner,
        type: DocumentType.VIDEO,
        originalName: 'lecture.mp4',
        storageRef: `media/${owner}/${randomUUID()}.mp4`,
        sizeBytes: 1024,
        status: DocumentStatus.UPLOADED,
      }),
    );

    await expect(service.confirm(owner, doc.id)).resolves.toMatchObject({
      status: DocumentStatus.PROBING,
    });
    expect(verifier.lastBucketKind).toBe('media');
  });

  it('rejects media confirmation when the object is missing from the media bucket', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);
    verifier.setResult({ exists: false, sizeBytes: 0 });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(verifier.lastBucketKind).toBe('media');
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(0);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.UPLOADED);
  });

  it('rejects media confirmation when storage versioning metadata is missing', async () => {
    const owner = randomUUID();
    const doc = await seedUploadedMedia(owner);
    verifier.setResult({ versionId: undefined });

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(await outbox.count({ where: { aggregateId: doc.id } })).toBe(0);
    expect((await documents.findOneByOrFail({ id: doc.id })).status).toBe(DocumentStatus.UPLOADED);
  });

  it('confirm rejects a media document over its policy cap', async () => {
    const owner = randomUUID();
    const doc = await documents.save(
      documents.create({
        ownerId: owner,
        type: DocumentType.AUDIO,
        originalName: 'lecture.mp3',
        storageRef: `${owner}/${randomUUID()}.mp3`,
        sizeBytes: MAX_MP3_SIZE_BYTES + 1,
        status: DocumentStatus.UPLOADED,
      }),
    );

    await expect(service.confirm(owner, doc.id)).rejects.toMatchObject({ status: 400 });
    expect(verifier.lastBucketKind).toBeUndefined();
  });
});
