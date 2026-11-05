import { Inject, Injectable } from '@nestjs/common';

import { DateTimeUtil } from '../../common/datetime.util';
import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../../config/application-config.service';
import type { MediaOrphanScannerSettings } from '../../config/configuration.types';
import { DocumentPurgeStorageError } from './contracts/document-purge-storage.port';
import {
  MEDIA_ORPHAN_STORAGE,
  MediaObjectVersion,
  MediaOrphanStorage,
} from './contracts/media-orphan-storage.port';
import { DocumentPurgeErrorCode } from './enums/document-purge-error-code.enum';
import {
  MediaObjectProtections,
  MediaOrphanReferenceRepository,
  mediaVersionProtectionKey,
} from './repositories/media-orphan-reference.repository';

/** The only prefix ever listed; the scanner never touches the documents bucket. */
export const MEDIA_ORPHAN_SCAN_PREFIX = 'media/';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** `media/<ownerId>/<documentSegment>[.ext]`, both segments UUIDs (see `ContentService.createUploadUrl`). */
const MEDIA_DOCUMENT_KEY = new RegExp(`^media/${UUID_PATTERN}/${UUID_PATTERN}(\\.[a-z0-9]{1,16})?$`, 'iu');
/** A bucket that was never versioned reports this pseudo version; it is never deleted here. */
const NULL_VERSION_ID = 'null';
const UNEXPECTED_ERROR_CODE = 'ORPHAN_SCAN_UNEXPECTED';
const LOCK_LOST_ERROR_CODE = 'ORPHAN_SCAN_LOCK_LOST';
/** IAM action the purge identity needs for listing; surfaced when it is denied. */
const REQUIRED_LIST_PERMISSION = 's3:ListBucketVersions';

export type MediaOrphanScanMode = 'dry-run' | 'delete';
export type MediaOrphanScanOutcome = 'COMPLETED' | 'SKIPPED_LOCK_HELD' | 'FAILED';

type MediaVersionVerdict =
  | 'ORPHAN'
  | 'OUT_OF_SCOPE'
  | 'REFERENCED'
  | 'TOO_YOUNG'
  | 'UNVERSIONED';

/** Counters of one scan run; also the payload of `media.orphan.scan.completed`. */
export interface MediaOrphanScanReport {
  readonly outcome: MediaOrphanScanOutcome;
  readonly mode: MediaOrphanScanMode;
  readonly scannedVersionCount: number;
  readonly orphanCount: number;
  readonly deletedCount: number;
  readonly skippedOutOfScopeCount: number;
  readonly skippedUnversionedCount: number;
  readonly skippedYoungCount: number;
  readonly skippedReferencedCount: number;
  readonly deleteMarkerCount: number;
  /** The run stopped on a cap or shutdown; the next run resumes after the last processed version. */
  readonly truncated: boolean;
  /** The whole `media/` prefix was listed to its end during this run (or runs it resumed). */
  readonly completedPass: boolean;
}

interface ScanCursor {
  readonly key: string;
  readonly versionId: string | undefined;
}

type ScanLock = NonNullable<Awaited<ReturnType<MediaOrphanReferenceRepository['tryAcquireScanLock']>>>;

/** The advisory lock disappeared mid-run (connection lost); nothing more may be deleted. */
class ScanLockLostError extends Error {
  constructor() {
    super('Media orphan scan lock was lost');
    this.name = ScanLockLostError.name;
  }
}

interface MutableCounters {
  scannedVersionCount: number;
  orphanCount: number;
  deletedCount: number;
  skippedOutOfScopeCount: number;
  skippedUnversionedCount: number;
  skippedYoungCount: number;
  skippedReferencedCount: number;
  deleteMarkerCount: number;
  truncated: boolean;
  completedPass: boolean;
}

/**
 * Cleans media object versions that no purge manifest or Document accounts
 * for (Q1/Q6 of #159), e.g. an upload through a still-valid presigned URL
 * after the Document was deleted. It never replaces the purge: a version is
 * orphan only when it is old enough and nothing in PostgreSQL references it.
 * When unsure it keeps the version. Without `deleteEnabled` it only reports.
 */
@Injectable()
export class MediaOrphanScannerService {
  private readonly logger = createApplicationLogger({ context: MediaOrphanScannerService.name });
  /** In-memory resume point; a restart simply starts a new pass from the beginning. */
  private cursor: ScanCursor | undefined;

  constructor(
    private readonly repository: MediaOrphanReferenceRepository,
    @Inject(MEDIA_ORPHAN_STORAGE) private readonly storage: MediaOrphanStorage,
    private readonly config: ApplicationConfigService,
  ) {}

  /** Runs one bounded scan. Never throws: failures are logged and reported as `FAILED`. */
  async scanOnce(signal?: AbortSignal): Promise<MediaOrphanScanReport> {
    const settings = this.config.mediaOrphanScanner;
    const mode: MediaOrphanScanMode = settings.deleteEnabled ? 'delete' : 'dry-run';
    const counters = createCounters();
    const startedAt = Date.now();
    let outcome: MediaOrphanScanOutcome = 'COMPLETED';
    let lock: ScanLock | undefined;

    try {
      lock = (await this.repository.tryAcquireScanLock()) ?? undefined;
      if (!lock) {
        outcome = 'SKIPPED_LOCK_HELD';
        this.logger.log({ event: 'media.orphan.scan.skipped', reason: 'LOCK_HELD', runtime: 'document-purge' });
        return toReport(outcome, mode, counters);
      }
      this.logger.log({ event: 'media.orphan.scan.started', mode, runtime: 'document-purge' });
      await this.scanPages(settings, counters, lock, signal);
      this.logger.log({
        ...toReport(outcome, mode, counters),
        durationMs: Date.now() - startedAt,
        event: 'media.orphan.scan.completed',
        runtime: 'document-purge',
      });
    } catch (error) {
      outcome = 'FAILED';
      this.logFailure(error, mode, counters);
    } finally {
      await this.releaseLock(lock);
    }
    return toReport(outcome, mode, counters);
  }

  private async scanPages(
    settings: MediaOrphanScannerSettings,
    counters: MutableCounters,
    lock: ScanLock,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const bucket = this.config.documentPurge.mediaBucket;
    const cutoffMs = DateTimeUtil.nowUtc().getTime() - settings.minAgeMs;

    // Delete markers count toward the budget too, so marker-only pages cannot loop unbounded.
    let listedEntryCount = 0;
    while (listedEntryCount < settings.maxObjectsPerRun) {
      const page = await this.storage.listObjectVersions({
        bucket,
        keyMarker: this.cursor?.key,
        maxKeys: Math.min(settings.pageSize, settings.maxObjectsPerRun - listedEntryCount),
        prefix: MEDIA_ORPHAN_SCAN_PREFIX,
        versionIdMarker: this.cursor?.versionId,
      });
      counters.deleteMarkerCount += page.deleteMarkerCount;
      listedEntryCount += page.versions.length + page.deleteMarkerCount;
      const protections = await this.repository.findProtections(
        collectCandidateKeys(page.versions, cutoffMs),
        bucket,
      );
      const isPageProcessed = await this.processPage({
        bucket, counters, cutoffMs, lock, protections, settings, signal, versions: page.versions,
      });
      if (!isPageProcessed) {
        counters.truncated = true;
        return;
      }
      if (!page.isTruncated) {
        this.cursor = undefined;
        counters.completedPass = true;
        return;
      }
      // Follow S3's own next marker: it can skip past delete markers when the page had no versions.
      if (page.nextKeyMarker === undefined) {
        // Truncated without a way to continue: stop rather than loop or claim a finished pass.
        if (page.versions.length === 0) {
          counters.truncated = true;
          return;
        }
      } else {
        this.cursor = { key: page.nextKeyMarker, versionId: page.nextVersionIdMarker };
      }
    }
    counters.truncated = true;
  }

  /** Returns false when the run must stop (orphan cap or shutdown) before the page ended. */
  private async processPage(input: {
    readonly bucket: string;
    readonly counters: MutableCounters;
    readonly cutoffMs: number;
    readonly lock: ScanLock;
    readonly protections: MediaObjectProtections;
    readonly settings: MediaOrphanScannerSettings;
    readonly signal: AbortSignal | undefined;
    readonly versions: readonly MediaObjectVersion[];
  }): Promise<boolean> {
    const { counters, settings } = input;
    for (const version of input.versions) {
      if (input.signal?.aborted) return false;
      const verdict = judgeVersion(version, input.cutoffMs, input.protections);
      if (verdict === 'ORPHAN' && counters.orphanCount >= settings.maxDeletesPerRun) return false;
      counters.scannedVersionCount += 1;
      if (verdict === 'ORPHAN') {
        await this.handleOrphan(input.bucket, version, settings, counters, input.lock);
      } else {
        countSkipped(counters, verdict);
      }
      // Advance only after the version was fully handled, so a failure retries it.
      this.cursor = { key: version.key, versionId: version.versionId ?? NULL_VERSION_ID };
    }
    return true;
  }

  private async handleOrphan(
    bucket: string,
    version: MediaObjectVersion,
    settings: MediaOrphanScannerSettings,
    counters: MutableCounters,
    lock: ScanLock,
  ): Promise<void> {
    const versionId = version.versionId ?? NULL_VERSION_ID;
    counters.orphanCount += 1;
    const details = {
      key: version.key,
      lastModified: version.lastModified?.toISOString(),
      runtime: 'document-purge',
      versionId,
    };
    if (!settings.deleteEnabled) {
      this.logger.log({ ...details, action: 'would_delete', event: 'media.orphan.candidate' });
      return;
    }
    // References can appear between the page lookup and the delete; ask again for this key.
    const fresh = await this.repository.findProtections([version.key], bucket);
    if (isProtected(fresh, version.key, versionId)) {
      counters.orphanCount -= 1;
      counters.skippedReferencedCount += 1;
      return;
    }
    if (counters.deletedCount > 0) await pause(settings.deleteDelayMs);
    // The single-runner guarantee only holds while the lock connection is alive.
    if (!(await isLockHeld(lock))) throw new ScanLockLostError();
    await this.storage.deleteObjectVersion({ bucket, key: version.key, versionId });
    counters.deletedCount += 1;
    this.logger.log({ ...details, action: 'deleted', event: 'media.orphan.deleted' });
  }

  private logFailure(error: unknown, mode: MediaOrphanScanMode, counters: MutableCounters): void {
    const isStorageError = error instanceof DocumentPurgeStorageError;
    this.logger.error({
      deletedCount: counters.deletedCount,
      errorCode: isStorageError
        ? error.code
        : error instanceof ScanLockLostError ? LOCK_LOST_ERROR_CODE : UNEXPECTED_ERROR_CODE,
      event: 'media.orphan.scan.failed',
      mode,
      // Fail-closed hint: a denied listing means the IAM statement is missing.
      ...(isStorageError && error.code === DocumentPurgeErrorCode.ACCESS_DENIED
        ? { requiredPermission: REQUIRED_LIST_PERMISSION }
        : {}),
      runtime: 'document-purge',
      scannedVersionCount: counters.scannedVersionCount,
    });
  }

  private async releaseLock(lock: ScanLock | undefined): Promise<void> {
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      this.logger.error({ event: 'media.orphan.scan.lock_release_failed', runtime: 'document-purge' });
    }
  }
}

/** A failing check (dead connection) means the lock is gone with it. */
async function isLockHeld(lock: ScanLock): Promise<boolean> {
  try {
    return await lock.isHeld();
  } catch {
    return false;
  }
}

/** Keys worth a database lookup: in scope, versioned and old enough. */
function collectCandidateKeys(versions: readonly MediaObjectVersion[], cutoffMs: number): string[] {
  const keys = new Set<string>();
  for (const version of versions) {
    if (isEligible(version, cutoffMs)) keys.add(version.key);
  }
  return [...keys];
}

function isEligible(version: MediaObjectVersion, cutoffMs: number): boolean {
  return MEDIA_DOCUMENT_KEY.test(version.key)
    && version.versionId !== undefined
    && version.versionId !== NULL_VERSION_ID
    && version.lastModified !== undefined
    && version.lastModified.getTime() <= cutoffMs;
}

function judgeVersion(
  version: MediaObjectVersion,
  cutoffMs: number,
  protections: MediaObjectProtections,
): MediaVersionVerdict {
  if (!MEDIA_DOCUMENT_KEY.test(version.key)) return 'OUT_OF_SCOPE';
  if (version.versionId === undefined || version.versionId === NULL_VERSION_ID) return 'UNVERSIONED';
  // An unknown timestamp is treated as young: when unsure, keep.
  if (version.lastModified === undefined || version.lastModified.getTime() > cutoffMs) return 'TOO_YOUNG';
  return isProtected(protections, version.key, version.versionId) ? 'REFERENCED' : 'ORPHAN';
}

function isProtected(protections: MediaObjectProtections, key: string, versionId: string): boolean {
  return protections.protectedKeys.has(key)
    || protections.protectedVersions.has(mediaVersionProtectionKey(key, versionId));
}

function countSkipped(counters: MutableCounters, verdict: Exclude<MediaVersionVerdict, 'ORPHAN'>): void {
  if (verdict === 'OUT_OF_SCOPE') counters.skippedOutOfScopeCount += 1;
  else if (verdict === 'UNVERSIONED') counters.skippedUnversionedCount += 1;
  else if (verdict === 'TOO_YOUNG') counters.skippedYoungCount += 1;
  else counters.skippedReferencedCount += 1;
}

function createCounters(): MutableCounters {
  return {
    completedPass: false,
    deleteMarkerCount: 0,
    deletedCount: 0,
    orphanCount: 0,
    scannedVersionCount: 0,
    skippedOutOfScopeCount: 0,
    skippedReferencedCount: 0,
    skippedUnversionedCount: 0,
    skippedYoungCount: 0,
    truncated: false,
  };
}

function toReport(
  outcome: MediaOrphanScanOutcome,
  mode: MediaOrphanScanMode,
  counters: MutableCounters,
): MediaOrphanScanReport {
  return { ...counters, mode, outcome };
}

function pause(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
