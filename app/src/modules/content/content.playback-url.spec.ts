import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { DateTimeUtil } from '../../common/datetime.util';
import type { CreatePresignedGetUrlInput } from '../../storage/storage.service';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';

const OWNER_ID = 'owner-1';
const DOCUMENT_ID = 'document-1';
const STORAGE_KEY = 'media/owner-1/secret-object-key.mp4';
const SIGNED_URL = 'https://storage.example/media/key?X-Amz-Signature=abc123';
const NOW = new Date('2026-09-04T00:00:00.000Z');

const createDocument = (overrides: Partial<Document> = {}): Document => Object.assign(new Document(), {
  id: DOCUMENT_ID,
  ownerId: OWNER_ID,
  type: DocumentType.VIDEO,
  status: DocumentStatus.READY,
  storageRef: STORAGE_KEY,
  sizeBytes: '1024',
  durationSec: 1800,
  mediaSourceBucket: 'media',
  mediaSourceVersionId: 'version-1',
  mediaSourceEtag: 'etag-1',
  mediaSourceContentLength: '1024',
  ...overrides,
});

interface Fixture {
  readonly service: ContentService;
  readonly findByOwnerId: jest.Mock<(...args: unknown[]) => Promise<Document | null>>;
  readonly createPresignedGetUrl: jest.Mock<(input: CreatePresignedGetUrlInput, bucket: string) => Promise<string>>;
  readonly loggerCalls: unknown[];
}

const createFixture = (mediaEnabled = true): Fixture => {
  const findByOwnerId = jest.fn<(...args: unknown[]) => Promise<Document | null>>();
  const createPresignedGetUrl = jest.fn<(input: CreatePresignedGetUrlInput, bucket: string) => Promise<string>>()
    .mockResolvedValue(SIGNED_URL);
  const storage = { createPresignedGetUrl, getBucketName: (bucket = 'documents'): string => bucket };
  const service = new ContentService(
    { findByOwnerId } as never,
    storage as never,
    null as never,
    null as never,
    undefined,
    { storage: { mediaEnabled } } as never,
  );
  const loggerCalls: unknown[] = [];
  const logger = (service as unknown as { logger: Record<string, unknown> }).logger;
  for (const level of ['log', 'warn', 'error']) {
    logger[level] = (payload: unknown): void => { loggerCalls.push(payload); };
  }
  return { service, findByOwnerId, createPresignedGetUrl, loggerCalls };
};

describe('ContentService.createMediaPlaybackUrl', () => {
  beforeEach(() => {
    jest.spyOn(DateTimeUtil, 'nowUtc').mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const inputCommand = { ownerId: OWNER_ID, documentId: DOCUMENT_ID, reason: 'INITIAL' } as const;

  it('looks the Document up by owner on every call and signs the pinned version', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument());

    const actualResult = await fixture.service.createMediaPlaybackUrl(inputCommand);

    expect(fixture.findByOwnerId).toHaveBeenCalledWith(OWNER_ID, DOCUMENT_ID);
    expect(fixture.createPresignedGetUrl).toHaveBeenCalledWith({
      key: STORAGE_KEY,
      versionId: 'version-1',
      responseContentType: 'video/mp4',
      expiresInSec: 14400,
      signingDate: NOW,
    }, 'media');
    expect(actualResult).toMatchObject({ url: SIGNED_URL, ttlSec: 14400, mimeType: 'video/mp4', durationSec: 1800 });
  });

  it('uses audio/mpeg for AUDIO Documents', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument({ type: DocumentType.AUDIO }));

    const actualResult = await fixture.service.createMediaPlaybackUrl(inputCommand);

    expect(actualResult.mimeType).toBe('audio/mpeg');
  });

  it.each([
    { durationSec: null, expectedTtl: 14400 },
    { durationSec: 300, expectedTtl: 14400 },
    { durationSec: 7200, expectedTtl: 14400 },
    { durationSec: 34800, expectedTtl: 42000 },
    { durationSec: 40000, expectedTtl: 43200 },
    { durationSec: 50000, expectedTtl: 43200 },
  ])('derives ttl $expectedTtl from duration $durationSec', async ({ durationSec, expectedTtl }) => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument({ durationSec }));

    const actualResult = await fixture.service.createMediaPlaybackUrl(inputCommand);

    expect(actualResult.ttlSec).toBe(expectedTtl);
    expect(actualResult.durationSec).toBe(durationSec);
    expect(actualResult.expiresAt).toEqual(new Date(NOW.getTime() + expectedTtl * 1000));
  });

  it('answers 404 for a missing or foreign Document', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(null);

    await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toMatchObject({
      constructor: NotFoundException,
      response: { code: 'DOCUMENT_NOT_FOUND' },
    });
    expect(fixture.createPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('answers 404 for a DELETING Document', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument({ status: DocumentStatus.DELETING }));

    await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 MEDIA_PLAYBACK_NOT_AVAILABLE for a PDF', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument({ type: DocumentType.PDF }));

    await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'MEDIA_PLAYBACK_NOT_AVAILABLE' },
    });
    expect(fixture.loggerCalls).toContainEqual({
      event: 'media.playback.url_rejected', documentId: DOCUMENT_ID, code: 'MEDIA_PLAYBACK_NOT_AVAILABLE',
    });
  });

  it.each([DocumentStatus.UPLOADED, DocumentStatus.PROBING, DocumentStatus.PROCESSING, DocumentStatus.FAILED])(
    'answers 409 MEDIA_PLAYBACK_NOT_READY for status %s',
    async (status) => {
      const fixture = createFixture();
      fixture.findByOwnerId.mockResolvedValue(createDocument({ status }));

      await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'MEDIA_PLAYBACK_NOT_READY' },
      });
    },
  );

  it('answers 409 MEDIA_SOURCE_IDENTITY_UNAVAILABLE and never signs without a locator', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument({ mediaSourceVersionId: null }));

    await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'MEDIA_SOURCE_IDENTITY_UNAVAILABLE' },
    });
    expect(fixture.createPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('answers 503 when media is disabled', async () => {
    const fixture = createFixture(false);
    fixture.findByOwnerId.mockResolvedValue(createDocument());

    await expect(fixture.service.createMediaPlaybackUrl(inputCommand)).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: { code: 'MEDIA_PLAYBACK_UNAVAILABLE' },
    });
  });

  it('answers a safe 503 when signing fails and logs only names', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument());
    fixture.createPresignedGetUrl.mockRejectedValue(
      Object.assign(new Error(`boom ${SIGNED_URL} ${STORAGE_KEY}`), { name: 'CredentialsProviderError' }),
    );

    const actualError = await fixture.service.createMediaPlaybackUrl(inputCommand).catch((error: unknown) => error);

    expect(actualError).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((actualError as ServiceUnavailableException).getResponse())).not.toContain('boom');
    expect(fixture.loggerCalls).toContainEqual({
      event: 'media.playback.sign_failed', documentId: DOCUMENT_ID, errorName: 'CredentialsProviderError', code: 'unknown',
    });
  });

  it('logs the issue event without URL, signature or storage reference', async () => {
    const fixture = createFixture();
    fixture.findByOwnerId.mockResolvedValue(createDocument());

    await fixture.service.createMediaPlaybackUrl({ ...inputCommand, reason: 'SCHEDULED_REFRESH' });

    expect(fixture.loggerCalls).toEqual([{
      event: 'media.playback.url_issued',
      documentId: DOCUMENT_ID,
      reason: 'SCHEDULED_REFRESH',
      ttlSec: 14400,
      documentType: DocumentType.VIDEO,
    }]);
    const serialized = JSON.stringify(fixture.loggerCalls);
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(serialized).not.toContain('storage.example');
    expect(serialized).not.toContain(STORAGE_KEY);
  });
});
