import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';

import { createTestDataSource } from '../../test-support/test-data-source';
import { FakeModelCatalog } from '../../test-support/fake-model-catalog';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';
import { startTestDb, type TestDb } from '../../test-support/test-db';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';
import { SubtitleTranscriptRepository } from './repositories/subtitle-transcript.repository';
import { SubtitlePreviewService } from './subtitles/subtitle-preview.service';

const VIDEO_ID = 'dQw4w9WgXcQ';
const FIXTURE_DIRECTORY = join(__dirname, 'subtitles', '__fixtures__');
const DOCUMENTS_BUCKET = 'learning-platform-dev-documents';

interface SnapshotRow {
  readonly cue_count: number;
  readonly duration_ms: string;
  readonly rights_confirmed_at: Date | null;
  readonly source_format: string;
}

class FakeObjectStorage {
  private readonly objects = new Map<string, Buffer>();
  readonly readKeys: string[] = [];

  put(key: string, content: Buffer): void {
    this.objects.set(key, content);
  }

  async readObject(key: string, maxBytes: number): Promise<Buffer> {
    this.readKeys.push(key);
    const content = this.objects.get(key);
    if (!content) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    if (content.length > maxBytes) throw new RangeError('Storage object exceeds the configured extraction limit');
    return content;
  }

  getBucketName(): string {
    return DOCUMENTS_BUCKET;
  }
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

describe('YouTube subtitle lesson flow', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let documents: Repository<Document>;
  let outbox: Repository<OutboxEvent>;
  let contentRepository: ContentRepository;
  let storage: FakeObjectStorage;
  let verifier: FakeStorageVerifier;
  let content: ContentService;
  let preview: SubtitlePreviewService;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    documents = dataSource.getRepository(Document);
    outbox = dataSource.getRepository(OutboxEvent);
    contentRepository = new ContentRepository(dataSource);
    storage = new FakeObjectStorage();
    verifier = new FakeStorageVerifier();
    verifier.setResult({ contentValidation: 'INVALID', exists: false, sizeBytes: 0 });
    content = new ContentService(
      contentRepository,
      storage as never,
      verifier,
      null as never,
      new FakeModelCatalog(),
      { youtubeLessonsEnabled: true } as never,
    );
    preview = new SubtitlePreviewService(contentRepository, storage as never, new SubtitleTranscriptRepository(dataSource), { youtubeLessonsEnabled: true } as never);
    await db.client.query(
      'TRUNCATE "ai"."media_probe_cancellation_tombstones", "ai"."media_probe_jobs", "ai"."processing_jobs", "course"."document_probe_receipts", "course"."document_purge_manifests", "course"."documents", "course"."outbox" CASCADE',
    );
  });

  function readFixture(name: string): Buffer {
    return readFileSync(join(FIXTURE_DIRECTORY, name));
  }

  async function seedYoutubeDocument(
    ownerId: string,
    subtitle: Buffer | null,
    overrides: Partial<Document> = {},
  ): Promise<Document> {
    const storageRef = `${ownerId}/${randomUUID()}.vtt`;
    if (subtitle) storage.put(storageRef, subtitle);
    return documents.save(documents.create({
      ownerId,
      originalName: 'bai-giang.vi.vtt',
      sizeBytes: subtitle?.length ?? 1024,
      status: DocumentStatus.UPLOADED,
      storageRef,
      type: DocumentType.YOUTUBE,
      youtubeVideoId: VIDEO_ID,
      ...overrides,
    }));
  }

  async function seedWallet(ownerId: string): Promise<void> {
    await db.client.query(
      'INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, 10000)',
      [ownerId],
    );
  }

  async function findSnapshot(documentId: string): Promise<SnapshotRow | undefined> {
    const result = await db.client.query<SnapshotRow>(
      'SELECT "cue_count", "duration_ms", "rights_confirmed_at", "source_format" FROM "course"."document_subtitle_transcripts" WHERE "document_id" = $1',
      [documentId],
    );
    return result.rows[0];
  }

  describe('preview', () => {
    it('stores the snapshot, sets the duration and returns every cue in seconds', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));

      const actualPreview = await preview.preview(ownerId, document.id);

      expect(actualPreview.format).toBe('VTT');
      expect(actualPreview.cueCount).toBe(5);
      expect(actualPreview.durationSec).toBe(3725);
      expect(actualPreview.cues[0]).toEqual({ startSec: 0.5, endSec: 1, text: '>> Mở đầu & giới thiệu' });
      const snapshot = await findSnapshot(document.id);
      expect(snapshot).toMatchObject({ cue_count: 5, duration_ms: '3725000', rights_confirmed_at: null, source_format: 'VTT' });
      expect((await documents.findOneByOrFail({ id: document.id })).durationSec).toBe(3725);
    });

    it('replaces the snapshot on a second preview instead of adding a row', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));

      await preview.preview(ownerId, document.id);
      await preview.preview(ownerId, document.id);

      const counted = await db.client.query<{ count: string }>(
        'SELECT count(*) FROM "course"."document_subtitle_transcripts" WHERE "document_id" = $1',
        [document.id],
      );
      expect(counted.rows[0].count).toBe('1');
    });

    it('rejects a Document of another owner as not found', async () => {
      const document = await seedYoutubeDocument(randomUUID(), readFixture('bai-giang.vi.vtt'));

      const actualError = await captureRejection(preview.preview(randomUUID(), document.id));

      expect(actualError).toBeInstanceOf(NotFoundException);
    });

    it.each([
      [DocumentStatus.PROCESSING],
      [DocumentStatus.READY],
      [DocumentStatus.FAILED],
    ])('refuses a preview while the Document is %s', async (status) => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'), { status });

      const actualError = await captureRejection(preview.preview(ownerId, document.id));

      expect(actualError).toBeInstanceOf(ConflictException);
      expect((actualError as ConflictException).getResponse()).toMatchObject({ code: 'SUBTITLE_PREVIEW_NOT_ALLOWED' });
      expect(storage.readKeys).toHaveLength(0);
    });

    it('refuses a preview for a non YOUTUBE Document', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'), {
        type: DocumentType.TEXT,
        youtubeVideoId: null,
        originalName: 'ghi-chu.txt',
      });

      const actualError = await captureRejection(preview.preview(ownerId, document.id));

      expect((actualError as ConflictException).getResponse()).toMatchObject({ code: 'SUBTITLE_PREVIEW_NOT_ALLOWED' });
    });

    it('maps a parse failure to a 400 with its code and line and stores nothing', async () => {
      const ownerId = randomUUID();
      const invalid = Buffer.from('WEBVTT\n\n00:00:61.000 --> 00:01:02.000\nxin chao\n', 'utf8');
      const document = await seedYoutubeDocument(ownerId, invalid);

      const actualError = await captureRejection(preview.preview(ownerId, document.id));

      expect(actualError).toBeInstanceOf(BadRequestException);
      expect((actualError as BadRequestException).getResponse()).toEqual({
        code: 'SUBTITLE_TIMESTAMP_INVALID',
        line: 3,
        message: 'A subtitle timestamp is invalid.',
        retryable: false,
      });
      expect(await findSnapshot(document.id)).toBeUndefined();
    });

    it('maps an oversized object to SUBTITLE_TOO_LARGE without a line', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));

      const actualError = await captureRejection(preview.preview(ownerId, document.id));

      expect((actualError as BadRequestException).getResponse()).toEqual({
        code: 'SUBTITLE_TOO_LARGE',
        message: 'The subtitle file is larger than 5 MiB.',
        retryable: false,
      });
    });

    it('fails verification when the object is missing or differs from the declared size', async () => {
      const ownerId = randomUUID();
      const missing = await seedYoutubeDocument(ownerId, null);
      const resized = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'), { sizeBytes: 7 });

      const missingError = await captureRejection(preview.preview(ownerId, missing.id));
      const resizedError = await captureRejection(preview.preview(ownerId, resized.id));

      expect(missingError).toBeInstanceOf(BadRequestException);
      expect(resizedError).toBeInstanceOf(BadRequestException);
      expect(await findSnapshot(resized.id)).toBeUndefined();
    });
  });

  describe('flag', () => {
    it('refuses preview and a new confirm with YOUTUBE_LESSONS_DISABLED but still allows retry', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);
      await preview.preview(ownerId, document.id);
      await content.confirm(ownerId, document.id, { rightsConfirmed: true });
      await documents.update({ id: document.id }, { errorCode: 'PROVIDER_UNAVAILABLE' as never, errorMessage: 'x', status: DocumentStatus.FAILED });
      const disabledConfig = { youtubeLessonsEnabled: false } as never;
      const disabledContent = new ContentService(contentRepository, storage as never, verifier, null as never, new FakeModelCatalog(), disabledConfig);
      const disabledPreview = new SubtitlePreviewService(contentRepository, storage as never, new SubtitleTranscriptRepository(dataSource), disabledConfig);
      const second = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));

      const previewError = await captureRejection(disabledPreview.preview(ownerId, second.id));
      const confirmError = await captureRejection(disabledContent.confirm(ownerId, second.id, { rightsConfirmed: true }));
      const retried = await disabledContent.retry(ownerId, document.id);

      expect((previewError as ConflictException).getResponse()).toMatchObject({ code: 'YOUTUBE_LESSONS_DISABLED' });
      expect((confirmError as ConflictException).getResponse()).toMatchObject({ code: 'YOUTUBE_LESSONS_DISABLED' });
      expect(retried.status).toBe(DocumentStatus.PROCESSING);
    });
  });

  describe('subtitle repository start', () => {
    const selection = { customModelConfigId: null, kind: 'PLAN', platformModelId: 'platform-default' } as const;

    it('returns null in RETRY mode when the Document is not FAILED, and for a DELETING Document', async () => {
      const ownerId = randomUUID();
      const processing = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await preview.preview(ownerId, processing.id);
      await db.client.query('UPDATE "course"."document_subtitle_transcripts" SET "rights_confirmed_at" = now() WHERE "document_id" = $1', [processing.id]);
      const deleting = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await preview.preview(ownerId, deleting.id);
      await documents.update({ id: deleting.id }, { status: DocumentStatus.DELETING });

      const uploadedRetry = await contentRepository.confirmSubtitleProcessing(ownerId, processing.id, selection, {
        allowedStatuses: [DocumentStatus.FAILED], mode: 'RETRY', rightsConfirmed: false,
      });
      const deletingConfirm = await contentRepository.confirmSubtitleProcessing(ownerId, deleting.id, selection, {
        allowedStatuses: [DocumentStatus.UPLOADED, DocumentStatus.FAILED], mode: 'CONFIRM', rightsConfirmed: true,
      });

      expect(uploadedRetry).toBeNull();
      expect(deletingConfirm).toBeNull();
      expect(await outbox.countBy({ aggregateId: processing.id })).toBe(0);
    });
  });

  describe('confirm', () => {
    it('requires the rights confirmation before anything else', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);
      await preview.preview(ownerId, document.id);

      const missingFlag = await captureRejection(content.confirm(ownerId, document.id));
      const falseFlag = await captureRejection(content.confirm(ownerId, document.id, { rightsConfirmed: false }));

      expect((missingFlag as BadRequestException).getResponse()).toMatchObject({ code: 'SUBTITLE_RIGHTS_CONFIRMATION_REQUIRED' });
      expect((falseFlag as BadRequestException).getResponse()).toMatchObject({ code: 'SUBTITLE_RIGHTS_CONFIRMATION_REQUIRED' });
      expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(DocumentStatus.UPLOADED);
      expect(await outbox.countBy({ aggregateId: document.id })).toBe(0);
    });

    it('requires a subtitle preview', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);

      const actualError = await captureRejection(content.confirm(ownerId, document.id, { rightsConfirmed: true }));

      expect(actualError).toBeInstanceOf(ConflictException);
      expect((actualError as ConflictException).getResponse()).toMatchObject({ code: 'SUBTITLE_PREVIEW_REQUIRED' });
      expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(DocumentStatus.UPLOADED);
    });

    it('records the rights, skips the raw object verifier and queues TEXT_EXTRACT for a platform model', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);
      await preview.preview(ownerId, document.id);

      const confirmed = await content.confirm(ownerId, document.id, { rightsConfirmed: true });

      expect(confirmed.status).toBe(DocumentStatus.PROCESSING);
      expect(verifier.verifyCalls).toBe(0);
      expect((await findSnapshot(document.id))?.rights_confirmed_at).toBeInstanceOf(Date);
      const events = await outbox.find({ where: { aggregateId: document.id } });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ jobType: 'TEXT_EXTRACT', ownerId });
    });

    it('queues FULL_PIPELINE directly for a CUSTOM model and charges nothing', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'), {
        customModelConfigId: randomUUID(),
        modelSelectionKind: 'CUSTOM',
        platformModelId: null,
      });
      await preview.preview(ownerId, document.id);

      await content.confirm(ownerId, document.id, { rightsConfirmed: true });

      const events = await outbox.find({ where: { aggregateId: document.id } });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ jobType: 'FULL_PIPELINE' });
    });

    it('is idempotent: a second confirm queues no second event', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);
      await preview.preview(ownerId, document.id);

      await content.confirm(ownerId, document.id, { rightsConfirmed: true });
      await content.confirm(ownerId, document.id, { rightsConfirmed: true });

      expect(await outbox.countBy({ aggregateId: document.id })).toBe(1);
    });

    it('retries a retryable failure without asking for the rights again', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await seedWallet(ownerId);
      await preview.preview(ownerId, document.id);
      await content.confirm(ownerId, document.id, { rightsConfirmed: true });
      await documents.update({ id: document.id }, {
        errorCode: 'PROVIDER_UNAVAILABLE' as never,
        errorMessage: 'Provider unavailable',
        status: DocumentStatus.FAILED,
      });

      const retried = await content.retry(ownerId, document.id);

      expect(retried.status).toBe(DocumentStatus.PROCESSING);
      expect(await outbox.countBy({ aggregateId: document.id })).toBe(2);
    });

    it('keeps a new preview from carrying over an earlier rights confirmation', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await preview.preview(ownerId, document.id);
      await db.client.query(
        'UPDATE "course"."document_subtitle_transcripts" SET "rights_confirmed_at" = now() WHERE "document_id" = $1',
        [document.id],
      );

      await preview.preview(ownerId, document.id);

      expect((await findSnapshot(document.id))?.rights_confirmed_at).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the snapshot in the same transaction and purges the raw subtitle object', async () => {
      const ownerId = randomUUID();
      const document = await seedYoutubeDocument(ownerId, readFixture('bai-giang.vi.vtt'));
      await preview.preview(ownerId, document.id);
      expect(await findSnapshot(document.id)).toBeDefined();

      const deleted = await contentRepository.deleteOwnedDocument(ownerId, document.id, {
        documents: DOCUMENTS_BUCKET,
        media: '',
      });

      expect(deleted?.status).toBe(DocumentStatus.DELETING);
      expect(await findSnapshot(document.id)).toBeUndefined();
      const manifest = await db.client.query<{ locators: readonly { key: string; bucket: string }[] }>(
        'SELECT "locators" FROM "course"."document_purge_manifests" WHERE "document_id" = $1',
        [document.id],
      );
      expect(manifest.rows[0].locators).toEqual([expect.objectContaining({ bucket: DOCUMENTS_BUCKET, key: document.storageRef })]);
    });

    it('keeps the snapshot of another Owner untouched', async () => {
      const firstOwner = randomUUID();
      const secondOwner = randomUUID();
      const first = await seedYoutubeDocument(firstOwner, readFixture('bai-giang.vi.vtt'));
      const second = await seedYoutubeDocument(secondOwner, readFixture('bai-giang.vi.vtt'));
      await preview.preview(firstOwner, first.id);
      await preview.preview(secondOwner, second.id);

      await contentRepository.deleteOwnedDocument(firstOwner, first.id, { documents: DOCUMENTS_BUCKET, media: '' });

      expect(await findSnapshot(first.id)).toBeUndefined();
      expect(await findSnapshot(second.id)).toBeDefined();
    });
  });
});
