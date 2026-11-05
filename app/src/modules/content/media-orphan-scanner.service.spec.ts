import { randomUUID } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type { MediaOrphanScannerSettings } from '../../config/configuration.types';
import { DocumentPurgeStorageError, PurgeObjectVersion } from './contracts/document-purge-storage.port';
import type {
  ListMediaObjectVersions,
  MediaObjectVersion,
  MediaObjectVersionPage,
  MediaOrphanStorage,
} from './contracts/media-orphan-storage.port';
import { DocumentPurgeErrorCode } from './enums/document-purge-error-code.enum';
import { MediaOrphanScannerService } from './media-orphan-scanner.service';
import {
  MediaObjectProtections,
  MediaOrphanReferenceRepository,
  mediaVersionProtectionKey,
} from './repositories/media-orphan-reference.repository';

const MEDIA_BUCKET = 'media-bucket';
const HOUR_MS = 3_600_000;
const MIN_AGE_MS = 24 * HOUR_MS;

function settingsFor(overrides: Partial<MediaOrphanScannerSettings> = {}): MediaOrphanScannerSettings {
  return {
    deleteDelayMs: 0,
    deleteEnabled: false,
    enabled: true,
    intervalMs: 3_600_000,
    maxDeletesPerRun: 100,
    maxObjectsPerRun: 1_000,
    minAgeMs: MIN_AGE_MS,
    pageSize: 100,
    ...overrides,
  };
}

function mediaKey(): string {
  return `media/${randomUUID()}/${randomUUID()}.mp4`;
}

function version(key: string, versionId: string, ageMs: number = 2 * MIN_AGE_MS): MediaObjectVersion {
  return { key, lastModified: new Date(Date.now() - ageMs), versionId };
}

/** Pages are returned in order; each call records its request. */
class FakeOrphanStorage implements MediaOrphanStorage {
  readonly listRequests: ListMediaObjectVersions[] = [];
  readonly deleted: PurgeObjectVersion[] = [];
  listError: Error | undefined;
  deleteError: Error | undefined;

  constructor(private readonly pages: MediaObjectVersionPage[]) {}

  async listObjectVersions(input: ListMediaObjectVersions): Promise<MediaObjectVersionPage> {
    this.listRequests.push(input);
    if (this.listError) throw this.listError;
    if (input.keyMarker === undefined) {
      return this.pages[0] ?? { deleteMarkerCount: 0, isTruncated: false, versions: [] };
    }
    // A marker a page handed out leads to the next page, even when that page has no versions.
    if (input.keyMarker !== undefined) {
      const handedOut = this.pages.findIndex((candidate) => candidate.nextKeyMarker === input.keyMarker
        && candidate.nextVersionIdMarker === input.versionIdMarker);
      if (handedOut >= 0) {
        return this.pages[handedOut + 1] ?? { deleteMarkerCount: 0, isTruncated: false, versions: [] };
      }
    }
    // Otherwise resume after the marker the way S3 does: by position in the flat list.
    const flat = this.pages.flatMap((page) => page.versions);
    const start = input.keyMarker === undefined
      ? 0
      : flat.findIndex((item) => item.key === input.keyMarker && item.versionId === input.versionIdMarker) + 1;
    let offset = 0;
    for (const candidate of this.pages) {
      if (start < offset + candidate.versions.length) {
        return { ...candidate, versions: candidate.versions.slice(start - offset) };
      }
      offset += candidate.versions.length;
    }
    return { deleteMarkerCount: 0, isTruncated: false, versions: [] };
  }

  async deleteObjectVersion(target: PurgeObjectVersion): Promise<void> {
    if (this.deleteError) throw this.deleteError;
    this.deleted.push(target);
  }
}

class FakeReferences {
  protections: MediaObjectProtections = { protectedKeys: new Set(), protectedVersions: new Set() };
  lockHeld = false;
  lockLostAfterChecks: number | undefined;
  private heldChecks = 0;
  releaseCount = 0;
  readonly lookups: string[][] = [];

  async tryAcquireScanLock(): Promise<{ isHeld(): Promise<boolean>; release(): Promise<void> } | null> {
    if (this.lockHeld) return null;
    return {
      isHeld: async (): Promise<boolean> => {
        this.heldChecks += 1;
        return this.lockLostAfterChecks === undefined || this.heldChecks <= this.lockLostAfterChecks;
      },
      release: async (): Promise<void> => { this.releaseCount += 1; },
    };
  }

  async findProtections(keys: readonly string[]): Promise<MediaObjectProtections> {
    this.lookups.push([...keys]);
    return this.protections;
  }
}

function page(
  versions: MediaObjectVersion[],
  isTruncated = false,
  deleteMarkerCount = 0,
  next?: { readonly key: string; readonly versionId: string },
): MediaObjectVersionPage {
  return {
    deleteMarkerCount,
    isTruncated,
    nextKeyMarker: next?.key,
    nextVersionIdMarker: next?.versionId,
    versions,
  };
}

describe('MediaOrphanScannerService', () => {
  let logged: Array<Record<string, unknown>>;
  let errors: Array<Record<string, unknown>>;

  beforeEach(() => {
    logged = [];
    errors = [];
    jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation((message: unknown) => {
      logged.push(message as Record<string, unknown>);
    });
    jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation((message: unknown) => {
      errors.push(message as Record<string, unknown>);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serviceFor(
    storage: FakeOrphanStorage,
    references: FakeReferences,
    settings: MediaOrphanScannerSettings = settingsFor(),
  ): MediaOrphanScannerService {
    const config = {
      documentPurge: { mediaBucket: MEDIA_BUCKET },
      mediaOrphanScanner: settings,
    } as unknown as ApplicationConfigService;
    return new MediaOrphanScannerService(
      references as unknown as MediaOrphanReferenceRepository,
      storage,
      config,
    );
  }

  it('skips a version younger than the minimum age without a reference lookup for it', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([page([version(key, 'v1', HOUR_MS)])]);
    const references = new FakeReferences();

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, orphanCount: 0, outcome: 'COMPLETED', skippedYoungCount: 1 });
    expect(references.lookups).toEqual([[]]);
    expect(storage.deleted).toEqual([]);
  });

  it('keeps a version whose key a Document or pending manifest still references', async () => {
    const referencedKey = mediaKey();
    const versionedKey = mediaKey();
    const storage = new FakeOrphanStorage([page([
      version(referencedKey, 'v1'),
      version(versionedKey, 'pending'),
      version(versionedKey, 'orphan'),
    ])]);
    const references = new FakeReferences();
    references.protections = {
      protectedKeys: new Set([referencedKey]),
      protectedVersions: new Set([mediaVersionProtectionKey(versionedKey, 'pending')]),
    };

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 1, orphanCount: 1, skippedReferencedCount: 2 });
    expect(storage.deleted).toEqual([{ bucket: MEDIA_BUCKET, key: versionedKey, versionId: 'orphan' }]);
  });

  it('skips keys outside the media document namespace and unversioned objects', async () => {
    const storage = new FakeOrphanStorage([page([
      version('media/not-a-uuid/not-a-uuid.mp4', 'v1'),
      version(`media/${randomUUID()}/nested/${randomUUID()}.mp4`, 'v2'),
      version(`media/${randomUUID()}.mp4`, 'v3'),
      version(`other/${randomUUID()}/${randomUUID()}.mp4`, 'v4'),
      version(mediaKey(), 'null'),
      { key: mediaKey(), lastModified: undefined, versionId: 'v5' },
      { key: mediaKey(), lastModified: new Date(Date.now() - 2 * MIN_AGE_MS), versionId: undefined },
    ], false, 3)]);
    const references = new FakeReferences();

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({
      deleteMarkerCount: 3,
      deletedCount: 0,
      orphanCount: 0,
      skippedOutOfScopeCount: 4,
      skippedUnversionedCount: 2,
      skippedYoungCount: 1,
    });
    expect(storage.deleted).toEqual([]);
    expect(storage.listRequests[0]).toMatchObject({ bucket: MEDIA_BUCKET, prefix: 'media/' });
  });

  it('reports candidates in dry-run and deletes nothing', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([page([version(key, 'orphan-v')])]);

    const report = await serviceFor(storage, new FakeReferences()).scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, mode: 'dry-run', orphanCount: 1, outcome: 'COMPLETED' });
    expect(storage.deleted).toEqual([]);
    expect(logged).toContainEqual(expect.objectContaining({
      action: 'would_delete', event: 'media.orphan.candidate', key, versionId: 'orphan-v',
    }));
    expect(logged).toContainEqual(expect.objectContaining({
      event: 'media.orphan.scan.completed', mode: 'dry-run', orphanCount: 1,
    }));
  });

  it('deletes the exact orphan version in delete mode and logs it', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([page([version(key, 'v-old'), version(key, 'v-older')])]);

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 2, mode: 'delete', orphanCount: 2 });
    expect(storage.deleted).toEqual([
      { bucket: MEDIA_BUCKET, key, versionId: 'v-old' },
      { bucket: MEDIA_BUCKET, key, versionId: 'v-older' },
    ]);
    expect(logged.filter((entry) => entry.event === 'media.orphan.deleted')).toHaveLength(2);
  });

  it('re-checks references right before deleting and keeps a version that gained one', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([page([version(key, 'v1')])]);
    const references = new FakeReferences();
    const lookup = references.findProtections.bind(references);
    references.findProtections = async (keys): Promise<MediaObjectProtections> => {
      const result = await lookup(keys);
      // The first (page) lookup sees no reference; the pre-delete one does.
      if (references.lookups.length > 1) {
        return { protectedKeys: new Set([key]), protectedVersions: new Set() };
      }
      return result;
    };

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, orphanCount: 0, skippedReferencedCount: 1 });
    expect(storage.deleted).toEqual([]);
  });

  it('paginates with the last processed version as the marker', async () => {
    const first = mediaKey();
    const second = mediaKey();
    const storage = new FakeOrphanStorage([
      page([version(first, 'a1'), version(first, 'a2')], true),
      page([version(second, 'b1')], false),
    ]);

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true })).scanOnce();

    expect(storage.listRequests.map((request) => [request.keyMarker, request.versionIdMarker])).toEqual([
      [undefined, undefined],
      [first, 'a2'],
    ]);
    expect(report).toMatchObject({ completedPass: true, deletedCount: 3, scannedVersionCount: 3, truncated: false });
  });

  it('follows the next marker through a truncated page that holds only delete markers', async () => {
    const afterMarkers = mediaKey();
    const markerKey = mediaKey();
    const storage = new FakeOrphanStorage([
      page([], true, 3, { key: markerKey, versionId: 'marker-v' }),
      page([version(afterMarkers, 'v1')], false),
    ]);

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true })).scanOnce();

    expect(storage.listRequests.map((request) => [request.keyMarker, request.versionIdMarker])).toEqual([
      [undefined, undefined],
      [markerKey, 'marker-v'],
    ]);
    expect(report).toMatchObject({ completedPass: true, deleteMarkerCount: 3, deletedCount: 1 });
  });

  it('does not report a finished pass for a truncated page it cannot continue from', async () => {
    const storage = new FakeOrphanStorage([page([], true, 2)]);

    const report = await serviceFor(storage, new FakeReferences()).scanOnce();

    expect(report).toMatchObject({ completedPass: false, outcome: 'COMPLETED', truncated: true });
    expect(storage.listRequests).toHaveLength(1);
  });

  it('keeps marker-only pages inside the per-run budget', async () => {
    const pages = Array.from({ length: 10 }, (_unused, index) => (
      page([], true, 10, { key: `media/${index}`, versionId: 'm' })
    ));
    const storage = new FakeOrphanStorage(pages);

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ maxObjectsPerRun: 30, pageSize: 10 })).scanOnce();

    expect(storage.listRequests).toHaveLength(3);
    expect(report).toMatchObject({ completedPass: false, deleteMarkerCount: 30, truncated: true });
  });

  it('resumes after the markers on the next run when the budget ended inside them', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([
      page([], true, 2, { key: 'media/m', versionId: 'm1' }),
      page([version(key, 'v1')], false),
    ]);
    const service = serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true, maxObjectsPerRun: 2, pageSize: 2 }));

    const first = await service.scanOnce();
    const second = await service.scanOnce();

    expect(first).toMatchObject({ completedPass: false, deletedCount: 0 });
    expect(second).toMatchObject({ completedPass: true, deletedCount: 1 });
    expect(storage.listRequests[1]).toMatchObject({ keyMarker: 'media/m', versionIdMarker: 'm1' });
  });

  it('aborts before deleting when the single-runner lock was lost', async () => {
    const storage = new FakeOrphanStorage([page([version(mediaKey(), 'v1'), version(mediaKey(), 'v2')])]);
    const references = new FakeReferences();
    references.lockLostAfterChecks = 1;

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 1, outcome: 'FAILED' });
    expect(errors).toContainEqual(expect.objectContaining({ errorCode: 'ORPHAN_SCAN_LOCK_LOST' }));
  });

  it('stops at the delete cap, then resumes after the last processed version', async () => {
    const keys = [mediaKey(), mediaKey(), mediaKey()];
    const storage = new FakeOrphanStorage([page(keys.map((key) => version(key, 'v1')))]);
    const service = serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true, maxDeletesPerRun: 2 }));

    const firstRun = await service.scanOnce();
    const secondRun = await service.scanOnce();

    expect(firstRun).toMatchObject({ completedPass: false, deletedCount: 2, scannedVersionCount: 2, truncated: true });
    expect(secondRun).toMatchObject({ completedPass: true, deletedCount: 1, truncated: false });
    expect(storage.deleted.map((target) => target.key)).toEqual(keys);
    expect(storage.listRequests[1]).toMatchObject({ keyMarker: keys[1], versionIdMarker: 'v1' });
  });

  it('caps dry-run candidates too, so a report stays bounded', async () => {
    const storage = new FakeOrphanStorage([page([mediaKey(), mediaKey(), mediaKey()].map((key) => version(key, 'v')))]);

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ maxDeletesPerRun: 1 })).scanOnce();

    expect(report).toMatchObject({ deletedCount: 0, orphanCount: 1, truncated: true });
    expect(logged.filter((entry) => entry.event === 'media.orphan.candidate')).toHaveLength(1);
  });

  it('bounds the page size by the remaining object budget', async () => {
    const storage = new FakeOrphanStorage([page([], true)]);

    await serviceFor(storage, new FakeReferences(), settingsFor({ maxObjectsPerRun: 50, pageSize: 100 })).scanOnce();

    expect(storage.listRequests[0].maxKeys).toBe(50);
  });

  it('stops when the shutdown signal aborts and keeps the cursor for the next run', async () => {
    const keys = [mediaKey(), mediaKey()];
    const storage = new FakeOrphanStorage([page(keys.map((key) => version(key, 'v1')))]);
    const controller = new AbortController();
    controller.abort();

    const report = await serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true }))
      .scanOnce(controller.signal);

    expect(report).toMatchObject({ deletedCount: 0, scannedVersionCount: 0, truncated: true });
  });

  it('fails closed with a structured log when listing is denied', async () => {
    const storage = new FakeOrphanStorage([]);
    storage.listError = new DocumentPurgeStorageError(DocumentPurgeErrorCode.ACCESS_DENIED);
    const references = new FakeReferences();

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report.outcome).toBe('FAILED');
    expect(storage.deleted).toEqual([]);
    expect(errors).toContainEqual(expect.objectContaining({
      errorCode: DocumentPurgeErrorCode.ACCESS_DENIED,
      event: 'media.orphan.scan.failed',
      requiredPermission: 's3:ListBucketVersions',
    }));
    expect(references.releaseCount).toBe(1);
  });

  it('aborts on a delete failure, keeps the version, and retries it next run', async () => {
    const key = mediaKey();
    const storage = new FakeOrphanStorage([page([version(key, 'v1')])]);
    storage.deleteError = new DocumentPurgeStorageError(DocumentPurgeErrorCode.STORAGE_TEMPORARY);
    const service = serviceFor(storage, new FakeReferences(), settingsFor({ deleteEnabled: true }));

    const failed = await service.scanOnce();
    storage.deleteError = undefined;
    const retried = await service.scanOnce();

    expect(failed).toMatchObject({ deletedCount: 0, outcome: 'FAILED' });
    expect(errors).toContainEqual(expect.objectContaining({
      errorCode: DocumentPurgeErrorCode.STORAGE_TEMPORARY, event: 'media.orphan.scan.failed',
    }));
    expect(retried).toMatchObject({ deletedCount: 1, outcome: 'COMPLETED' });
  });

  it('reports an unexpected error without leaking its message', async () => {
    const storage = new FakeOrphanStorage([]);
    storage.listError = new Error('secret-host.internal refused');

    const report = await serviceFor(storage, new FakeReferences()).scanOnce();

    expect(report.outcome).toBe('FAILED');
    expect(JSON.stringify(errors)).not.toContain('secret-host');
    expect(errors).toContainEqual(expect.objectContaining({ errorCode: 'ORPHAN_SCAN_UNEXPECTED' }));
  });

  it('skips the cycle when another runner holds the lock', async () => {
    const storage = new FakeOrphanStorage([page([version(mediaKey(), 'v1')])]);
    const references = new FakeReferences();
    references.lockHeld = true;

    const report = await serviceFor(storage, references, settingsFor({ deleteEnabled: true })).scanOnce();

    expect(report.outcome).toBe('SKIPPED_LOCK_HELD');
    expect(storage.listRequests).toEqual([]);
    expect(storage.deleted).toEqual([]);
  });
});
