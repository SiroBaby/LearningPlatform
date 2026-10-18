import { Inject, Injectable } from '@nestjs/common';

import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../../config/application-config.service';
import type { DocumentPurgeSettings } from '../../config/configuration.types';
import {
  DOCUMENT_PURGE_STORAGE,
  DocumentPurgeStorage,
  DocumentPurgeStorageError,
} from './contracts/document-purge-storage.port';
import type { DocumentPurgeLocator } from './entities/document-purge-manifest.entity';
import { BucketVersioningState } from './enums/bucket-versioning-state.enum';
import { DocumentPurgeErrorCode } from './enums/document-purge-error-code.enum';
import {
  ClaimedDocumentPurgeManifest,
  DocumentPurgeBacklog,
  DocumentPurgeRepository,
} from './repositories/document-purge.repository';

/** Manifests are claimed one at a time so each lease covers only its own work. */
const MANIFESTS_PER_CLAIM = 1;
const IMMEDIATE_DEAD_LETTER_CODES: ReadonlySet<DocumentPurgeErrorCode> = new Set([
  DocumentPurgeErrorCode.ACCESS_DENIED,
  DocumentPurgeErrorCode.CONFIGURATION,
  DocumentPurgeErrorCode.UNVERSIONED_LOCATOR,
]);

/**
 * Physically deletes the object versions captured in a purge manifest.
 * Only versions listed in the manifest are deleted (no listing of the key);
 * versions created later are left to the orphan scanner.
 */
@Injectable()
export class DocumentPurgeService {
  private readonly logger = createApplicationLogger({ context: DocumentPurgeService.name });

  constructor(
    private readonly repository: DocumentPurgeRepository,
    @Inject(DOCUMENT_PURGE_STORAGE) private readonly storage: DocumentPurgeStorage,
    private readonly config: ApplicationConfigService,
  ) {}

  /** Fails closed unless the media bucket keeps every version until purge. */
  async assertMediaBucketVersioned(): Promise<void> {
    const state = await this.storage.getBucketVersioning(this.config.documentPurge.mediaBucket);
    if (state !== BucketVersioningState.ENABLED) {
      throw new DocumentPurgeStorageError(
        DocumentPurgeErrorCode.MEDIA_BUCKET_NOT_VERSIONED,
        'Media bucket versioning must be Enabled before document purge can start',
      );
    }
  }

  /** Read-only queue depth for the periodic `document.purge.backlog` log. */
  async readBacklog(): Promise<DocumentPurgeBacklog> {
    return this.repository.summarizeBacklog();
  }

  /** Processes up to the configured batch of due manifests; returns how many. */
  async purgeDueManifests(): Promise<number> {
    const settings = this.config.documentPurge;
    let processed = 0;
    while (processed < settings.batchSize) {
      const [manifest] = await this.repository.claimDue({
        leaseMs: settings.leaseMs,
        limit: MANIFESTS_PER_CLAIM,
      });
      if (!manifest) break;
      await this.purgeManifest(manifest, settings);
      processed += 1;
    }
    return processed;
  }

  private async purgeManifest(
    manifest: ClaimedDocumentPurgeManifest,
    settings: DocumentPurgeSettings,
  ): Promise<void> {
    // A worker that crashed on every previous attempt never reached the
    // failure path, so the cap is also enforced at claim time.
    if (manifest.attempts > settings.maxAttempts) {
      await this.deadLetter(manifest, DocumentPurgeErrorCode.ATTEMPTS_EXHAUSTED);
      return;
    }
    // No captured version means the deletion could not prove which bytes
    // belong to the Document (e.g. a presigned upload may still land). Q1
    // forbids listing the key, so it must not be reported as purged.
    if (manifest.locators.length === 0) {
      await this.deadLetter(manifest, DocumentPurgeErrorCode.LOCATORS_UNRESOLVED);
      return;
    }
    if (await this.repository.hasActiveReference({
      documentId: manifest.documentId,
      documentsBucket: settings.documentsBucket,
      locators: manifest.locators,
      mediaBucket: settings.mediaBucket,
    })) {
      await this.deadLetter(manifest, DocumentPurgeErrorCode.ACTIVE_REFERENCE);
      return;
    }

    try {
      for (const locator of manifest.locators) {
        // Each locator starts with a full lease, however many the manifest has.
        if (!(await this.repository.renewLease({
          id: manifest.id,
          leaseId: manifest.leaseId,
          leaseMs: settings.leaseMs,
        }))) {
          this.logLeaseLost(manifest);
          return;
        }
        await this.deleteLocator(locator, settings);
      }
    } catch (error) {
      await this.handleFailure(manifest, this.errorCodeOf(error), settings);
      return;
    }

    if (!(await this.repository.complete(manifest.id, manifest.leaseId))) {
      this.logLeaseLost(manifest);
      return;
    }
    this.logger.log({
      documentId: manifest.documentId,
      event: 'document.purge.completed',
      manifestId: manifest.id,
      versionCount: manifest.locators.length,
    });
  }

  private async deleteLocator(
    locator: DocumentPurgeLocator,
    settings: DocumentPurgeSettings,
  ): Promise<void> {
    if (locator.bucket !== settings.mediaBucket && locator.bucket !== settings.documentsBucket) {
      throw new DocumentPurgeStorageError(DocumentPurgeErrorCode.CONFIGURATION);
    }
    if (locator.versionId) {
      await this.storage.deleteObjectVersion({
        bucket: locator.bucket,
        key: locator.key,
        versionId: locator.versionId,
      });
      return;
    }
    // Without a VersionId, deleting by key is a hard delete only on a bucket
    // that never had versioning; otherwise it would just add a delete marker.
    const versioning = await this.storage.getBucketVersioning(locator.bucket);
    if (versioning !== BucketVersioningState.UNVERSIONED) {
      throw new DocumentPurgeStorageError(DocumentPurgeErrorCode.UNVERSIONED_LOCATOR);
    }
    await this.storage.deleteObject({ bucket: locator.bucket, key: locator.key });
  }

  private async handleFailure(
    manifest: ClaimedDocumentPurgeManifest,
    errorCode: DocumentPurgeErrorCode,
    settings: DocumentPurgeSettings,
  ): Promise<void> {
    if (IMMEDIATE_DEAD_LETTER_CODES.has(errorCode)) {
      await this.deadLetter(manifest, errorCode);
      return;
    }
    if (manifest.attempts >= settings.maxAttempts) {
      await this.deadLetter(manifest, DocumentPurgeErrorCode.ATTEMPTS_EXHAUSTED);
      return;
    }
    const delayMs = this.retryDelayMs(manifest.attempts, settings);
    if (!(await this.repository.scheduleRetry({
      delayMs,
      errorCode,
      id: manifest.id,
      leaseId: manifest.leaseId,
    }))) {
      this.logLeaseLost(manifest);
      return;
    }
    this.logger.warn({
      attempts: manifest.attempts,
      delayMs,
      documentId: manifest.documentId,
      errorCode,
      event: 'document.purge.retry_scheduled',
      manifestId: manifest.id,
    });
  }

  private async deadLetter(
    manifest: ClaimedDocumentPurgeManifest,
    errorCode: DocumentPurgeErrorCode,
  ): Promise<void> {
    if (!(await this.repository.deadLetter({
      errorCode,
      id: manifest.id,
      leaseId: manifest.leaseId,
    }))) {
      this.logLeaseLost(manifest);
      return;
    }
    this.logger.error({
      attempts: manifest.attempts,
      documentId: manifest.documentId,
      errorCode,
      event: 'document.purge.dead_lettered',
      manifestId: manifest.id,
      versionCount: manifest.locators.length,
    });
  }

  /** Exponential backoff from the first attempt, capped at the configured max. */
  private retryDelayMs(attempts: number, settings: DocumentPurgeSettings): number {
    const exponent = Math.max(0, attempts - 1);
    return Math.min(settings.backoffMaxMs, settings.backoffBaseMs * 2 ** exponent);
  }

  /** Unclassified failures are retried; the attempt cap keeps them bounded. */
  private errorCodeOf(error: unknown): DocumentPurgeErrorCode {
    return error instanceof DocumentPurgeStorageError
      ? error.code
      : DocumentPurgeErrorCode.STORAGE_TEMPORARY;
  }

  private logLeaseLost(manifest: ClaimedDocumentPurgeManifest): void {
    this.logger.warn({
      documentId: manifest.documentId,
      event: 'document.purge.lease_lost',
      manifestId: manifest.id,
    });
  }
}
