import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { normalizeStorageVersionId } from '../../../storage/storage-version-id';
import { CreateUploadUrlCommand } from '../contracts/create-upload-url.command';
import {
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from '../contracts/document-status-projection.port';
import { Document } from '../entities/document.entity';
import {
  DocumentPurgeManifest,
  type DocumentPurgeLocator,
} from '../entities/document-purge-manifest.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { JobType } from '../../ai/enums/job-type.enum';
import type { DocumentModelSelection } from '../../ai/contracts/model-selection.contracts';
import { BudgetExhaustedError } from '../../ai/budget-exhausted.error';
import type {
  DocumentProbeCompletionCommand,
  DocumentProbeCompletionOutcome,
  DocumentProbeFailureCommand,
  DocumentProbeFailureOutcome,
} from '../contracts/document-status-projection.port';
import { MEDIA_PROBE_JOB_TYPE } from '../contracts/media-probe-policy';

@Injectable()
export class ContentRepository extends BaseRepository<Document> {
  constructor(private readonly dataSource: DataSource) {
    super(Document, dataSource);
  }

  async createUploaded(
    ownerId: string,
    command: CreateUploadUrlCommand & { readonly estimatedCredits: number; readonly selectedModelLabel: string },
    storageRef: string,
  ): Promise<Document> {
    const document = this.create({
      ownerId,
      type: command.type,
      originalName: command.originalName,
      storageRef,
      sizeBytes: command.sizeBytes,
      customModelConfigId: command.selection.customModelConfigId,
      modelSelectionKind: command.selection.kind,
      platformModelId: command.selection.platformModelId,
      selectedModelLabel: command.selectedModelLabel,
      estimateStatus: 'COARSE',
      estimatedCredits: command.estimatedCredits,
      budgetStatus: command.selection.kind === 'CUSTOM' ? 'CUSTOM_ZERO_COST' : 'NOT_RESERVED',
      status: DocumentStatus.UPLOADED,
    });

    return this.save(document);
  }

  async findByOwnerId(ownerId: string, id: string): Promise<Document | null> {
    return this.findOne({ where: { id, ownerId } });
  }

  async findAllByOwnerId(ownerId: string): Promise<Document[]> {
    return this.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Re-read the course-owned Document immediately before forwarding an event
   * into the AI schema. A deletion fence mismatch makes the outbox row stale.
   */
  async isForwardableDocumentEvent(
    documentId: string,
    ownerId: string,
    expectedStatus: DocumentStatus,
    expectedDeletionFence: number | undefined,
    expectedIdentity?: DocumentEventIdentity,
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(expectedDeletionFence) ||
      (expectedDeletionFence as number) < 0
    ) {
      return false;
    }
    const document = await this.findOne({ where: { id: documentId, ownerId } });
    if (!document || document.status !== expectedStatus || Number(document.deletionFence) !== expectedDeletionFence) {
      return false;
    }
    if (expectedIdentity?.requireProbeIdentity && (
      !expectedIdentity.probeGeneration ||
      !expectedIdentity.policyVersion ||
      !expectedIdentity.fullPipelineJobId ||
      !Number.isSafeInteger(expectedIdentity.processingAttempt) ||
      (expectedIdentity.processingAttempt as number) < 1
    )) {
      return false;
    }
    if (expectedIdentity?.probeGeneration !== undefined && document.probeGeneration !== expectedIdentity.probeGeneration) {
      return false;
    }
    if (expectedIdentity?.policyVersion !== undefined && document.probePolicyVersion !== expectedIdentity.policyVersion) {
      return false;
    }
    if (expectedIdentity?.fullPipelineJobId !== undefined && document.fullPipelineJobId !== expectedIdentity.fullPipelineJobId) {
      return false;
    }
    if (expectedIdentity?.processingAttempt !== undefined && Number(document.processingAttempt) !== expectedIdentity.processingAttempt) {
      return false;
    }
    return true;
  }

  async deleteOwnedDocument(
    ownerId: string,
    id: string,
    buckets: DocumentStorageBuckets,
    preflightMediaLocator?: DocumentPurgeLocator,
  ): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) return null;

      // A committed DELETING tombstone is the idempotent result. Do not create
      // another manifest or outbox row for a repeated request.
      if (document.status === DocumentStatus.DELETING) return document;

      const persistedMediaLocator = this.isMediaDocument(document)
        ? this.mediaPurgeLocatorFromDocument(document, buckets.media)
        : null;
      const canonicalPreflightLocator = this.canonicalizeMediaPurgeLocator(preflightMediaLocator);
      const shouldPersistPreflightLocator = this.isMediaDocument(document) &&
        persistedMediaLocator === null &&
        this.isExactMediaPurgeLocator(canonicalPreflightLocator, document, buckets.media);
      const locators = await this.collectPurgeLocators(
        manager,
        document,
        buckets,
        shouldPersistPreflightLocator ? canonicalPreflightLocator : undefined,
      );

      const nextDeletionFence = Number(document.deletionFence) + 1;
      const updated = await manager.update(
        Document,
        {
          deletionFence: document.deletionFence,
          id,
          ownerId,
          status: document.status,
        },
        {
          deletionFence: nextDeletionFence,
          status: DocumentStatus.DELETING,
          ...(shouldPersistPreflightLocator ? {
            mediaSourceBucket: canonicalPreflightLocator!.bucket,
            mediaSourceVersionId: canonicalPreflightLocator!.versionId,
            mediaSourceEtag: canonicalPreflightLocator!.etag,
            mediaSourceContentLength: canonicalPreflightLocator!.contentLength,
          } : {}),
        },
      );
      if (updated.affected !== 1) {
        return manager.findOne(Document, { where: { id, ownerId } });
      }

      // The deletion fence and the AI cancellation marker commit together.
      // The relay remains an idempotent retry path, but it is no longer the
      // first line of defence against a stale enqueue racing with deletion.
      await this.cancelAiWork(
        manager,
        id,
        ownerId,
        nextDeletionFence,
        this.isMediaDocument(document),
      );

      const cancellationEvent = manager.create(OutboxEvent, {
        aggregateId: id,
        eventType: 'DocumentProcessingCancelled',
        payload: {
          deletionFence: nextDeletionFence,
          documentId: id,
          ownerId,
          reason: 'DOCUMENT_DELETED',
          version: 1,
        },
        publishedAt: null,
      });
      await manager.save(cancellationEvent);

      const manifest = manager.create(DocumentPurgeManifest, {
        documentId: id,
        ownerId,
        deletionFence: nextDeletionFence,
        idempotencyKey: `document-purge:${id}:${nextDeletionFence}`,
        locators,
      });
      const savedManifest = await manager.save(manifest);

      const purgeEvent = manager.create(OutboxEvent, {
        aggregateId: id,
        eventType: 'DocumentPurgeRequested',
        payload: {
          deletionFence: nextDeletionFence,
          documentId: id,
          locators,
          ownerId,
          purgeManifestId: savedManifest.id,
          locatorStatus: locators.length > 0 ? 'READY' : 'PENDING',
          sourceBucket: this.isMediaDocument(document) ? buckets.media : buckets.documents,
          sourceKey: document.storageRef,
          version: 1,
        },
        publishedAt: null,
      });
      await manager.save(purgeEvent);

      return manager.findOneByOrFail(Document, { id, ownerId });
    });
  }

  /**
   * Narrow cross-schema exception for Document deletion. This is deliberately
   * kept as explicit SQL so the state/fence predicates remain easy to audit.
   */
  private async cancelAiWork(
    manager: EntityManager,
    documentId: string,
    ownerId: string,
    deletionFence: number,
    isMediaDocument: boolean,
  ): Promise<void> {
    if (isMediaDocument) {
      // Serialize with the media enqueue path, which uses this same key.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
        [`media-probe:${documentId}:${ownerId}`],
      );
      const mediaCancellationKey = `document-cancel:${documentId}:${deletionFence}:MEDIA_PROBE`;
      await manager.query(
        `INSERT INTO "ai"."media_probe_cancellation_tombstones"
           ("document_id", "owner_id", "deletion_fence", "reason", "event_idempotency_key")
         VALUES ($1, $2, $3, 'DOCUMENT_DELETED', $4)
         ON CONFLICT ("document_id", "owner_id", "deletion_fence") DO NOTHING`,
        [documentId, ownerId, deletionFence, mediaCancellationKey],
      );

      await manager.query(
        `UPDATE "ai"."media_probe_jobs"
         SET "status" = 'CANCELLED',
             "lease_id" = NULL,
             "lease_until" = NULL,
             "updated_at" = now()
         WHERE "document_id" = $1
           AND "owner_id" = $2
           AND "deletion_fence" <= $3
           AND "status" IN ('PENDING', 'RUNNING')`,
        [documentId, ownerId, deletionFence],
      );
    }

    const cancellationMarkerId = randomUUID();
    const cancelledJobs: Array<{ readonly id: string }> = await manager.query(
      `UPDATE "ai"."processing_jobs"
       SET "status" = 'CANCELLED',
           "cancellation_marker_id" = COALESCE("cancellation_marker_id", $3::uuid),
           "cancellation_reason" = COALESCE("cancellation_reason", 'DOCUMENT_DELETED'),
           "cancelled_at" = COALESCE("cancelled_at", now()),
           "lease_id" = NULL,
           "lease_until" = NULL,
           "updated_at" = now()
       WHERE "document_id" = $1
         AND "owner_id" = $2
         AND "job_type" = 'FULL_PIPELINE'
         AND "status" NOT IN ('COMPLETED', 'CANCELLED')
       RETURNING "id"`,
      [documentId, ownerId, cancellationMarkerId],
    );

    if (cancelledJobs.length === 0) {
      // A placeholder occupies the document-scoped unique slot when the
      // forward relay has not created FULL_PIPELINE yet.
      await manager.query(
        `INSERT INTO "ai"."processing_jobs"
           ("document_id", "owner_id", "job_type", "status", "idempotency_key",
            "correlation_id", "deletion_fence", "cancellation_marker_id",
            "cancellation_reason", "cancelled_at")
         VALUES ($1, $2, 'FULL_PIPELINE', 'CANCELLED', $3, $4, $5, $6,
                 'DOCUMENT_DELETED', now())
         ON CONFLICT ("document_id") WHERE "job_type" = 'FULL_PIPELINE' DO NOTHING`,
        [
          documentId,
          ownerId,
          `document-cancel:${documentId}:FULL_PIPELINE`,
          randomUUID(),
          deletionFence,
          cancellationMarkerId,
        ],
      );
    }
  }

  private async collectPurgeLocators(
    manager: EntityManager,
    document: Document,
    buckets: DocumentStorageBuckets,
    additionalLocator?: DocumentPurgeLocator,
  ): Promise<DocumentPurgeLocator[]> {
    if (this.isMediaDocument(document)) {
      const candidates = [
        this.mediaPurgeLocatorFromDocument(document, buckets.media),
        this.canonicalizeMediaPurgeLocator(additionalLocator),
        ...(await this.findHistoricalMediaPurgeLocators(manager, document, buckets.media)),
      ];
      const unique = new Map<string, DocumentPurgeLocator>();
      for (const locator of candidates) {
        if (!locator || !this.isStoredMediaPurgeLocator(locator, buckets.media)) continue;
        unique.set(`${locator.bucket}\u0000${locator.key}\u0000${locator.versionId}`, locator);
      }
      return [...unique.values()];
    }
    return [{
      bucket: buckets.documents,
      key: document.storageRef,
      versionId: null,
      etag: null,
      contentLength: Number(document.sizeBytes),
    }];
  }

  private async findHistoricalMediaPurgeLocators(
    manager: EntityManager,
    document: Document,
    mediaBucket: string,
  ): Promise<DocumentPurgeLocator[]> {
    type LocatorRow = {
      readonly bucket: string | null;
      readonly key: string | null;
      readonly versionId: string | null;
      readonly etag: string | null;
      readonly contentLength: string | number | null;
    };

    const rows = await manager.query<LocatorRow[]>(
      `SELECT "source_bucket" AS "bucket", "source_key" AS "key",
              "source_version_id" AS "versionId", "source_etag" AS "etag",
              "source_content_length" AS "contentLength"
         FROM "course"."document_probe_receipts"
        WHERE "document_id" = $1 AND "owner_id" = $2`,
      [document.id, document.ownerId],
    );

    return rows
      .map((row) => ({
        bucket: row.bucket?.trim() ?? '',
        key: row.key?.trim() ?? '',
        versionId: normalizeStorageVersionId(row.versionId) ?? null,
        etag: row.etag?.trim() ?? null,
        contentLength: row.contentLength === null || row.contentLength === undefined
          ? null
          : Number(row.contentLength),
      }))
      .filter((locator): locator is DocumentPurgeLocator => this.isStoredMediaPurgeLocator(locator, mediaBucket))
      .sort((left, right) => this.purgeLocatorKey(left).localeCompare(this.purgeLocatorKey(right)));
  }

  private purgeLocatorKey(locator: DocumentPurgeLocator): string {
    return `${locator.bucket}\u0000${locator.key}\u0000${locator.versionId ?? ''}`;
  }

  private isStoredMediaPurgeLocator(
    locator: DocumentPurgeLocator,
    mediaBucket: string,
  ): locator is DocumentPurgeLocator & { readonly versionId: string; readonly etag: string; readonly contentLength: number } {
    return locator.bucket === mediaBucket &&
      locator.key.trim() !== '' &&
      normalizeStorageVersionId(locator.versionId) !== undefined &&
      typeof locator.etag === 'string' && locator.etag.trim() !== '' &&
      typeof locator.contentLength === 'number' && Number.isSafeInteger(locator.contentLength) &&
      locator.contentLength >= 0;
  }

  private mediaPurgeLocatorFromDocument(
    document: Document,
    mediaBucket: string,
  ): DocumentPurgeLocator | null {
    const locator = this.canonicalizeMediaPurgeLocator({
      bucket: document.mediaSourceBucket ?? mediaBucket,
      key: document.storageRef,
      versionId: document.mediaSourceVersionId,
      etag: document.mediaSourceEtag,
      contentLength: document.mediaSourceContentLength === null
        ? Number(document.sizeBytes)
        : Number(document.mediaSourceContentLength),
    });
    return this.isExactMediaPurgeLocator(locator, document, mediaBucket) ? locator : null;
  }

  private canonicalizeMediaPurgeLocator(
    locator: DocumentPurgeLocator | undefined,
  ): DocumentPurgeLocator | undefined {
    if (!locator) return undefined;
    return {
      ...locator,
      versionId: normalizeStorageVersionId(locator.versionId) ?? null,
      etag: typeof locator.etag === 'string' ? locator.etag.trim() : locator.etag,
    };
  }

  private isMediaDocument(document: Document): boolean {
    return document.type === DocumentType.AUDIO || document.type === DocumentType.VIDEO;
  }

  private isExactMediaPurgeLocator(
    locator: DocumentPurgeLocator | undefined,
    document: Document,
    mediaBucket: string,
  ): locator is DocumentPurgeLocator & { readonly versionId: string; readonly etag: string; readonly contentLength: number } {
    const contentLength = locator?.contentLength;
    return Boolean(
      locator &&
      locator.bucket === mediaBucket &&
      locator.key === document.storageRef &&
      normalizeStorageVersionId(locator.versionId) !== undefined &&
      typeof locator.etag === 'string' &&
      locator.etag.trim() !== '' &&
      typeof contentLength === 'number' &&
      Number.isSafeInteger(contentLength) &&
      contentLength >= 0 &&
      contentLength === Number(document.sizeBytes),
    );
  }

  private sameMediaPurgeLocator(
    left: DocumentPurgeLocator,
    right: DocumentPurgeLocator,
  ): boolean {
    const canonicalLeft = this.canonicalizeMediaPurgeLocator(left)!;
    const canonicalRight = this.canonicalizeMediaPurgeLocator(right)!;
    return canonicalLeft.bucket === canonicalRight.bucket &&
      canonicalLeft.key === canonicalRight.key &&
      canonicalLeft.versionId === canonicalRight.versionId &&
      canonicalLeft.etag === canonicalRight.etag &&
      canonicalLeft.contentLength === canonicalRight.contentLength;
  }

  async confirmProcessing(
    ownerId: string,
    id: string,
    selection: DocumentModelSelection,
  ): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const started = await this.startProcessing(manager, ownerId, id, [
        DocumentStatus.UPLOADED,
        DocumentStatus.FAILED,
      ]);

      if (started) {
        const document = await manager.findOneByOrFail(Document, { id, ownerId });
        await this.enqueueProcessing(
          manager,
          ownerId,
          id,
          selection,
          Number(document.deletionFence),
          document.fullPipelineJobId,
          Number(document.processingAttempt),
        );
      }

      return manager.findOne(Document, { where: { id, ownerId } });
    });
  }

  /**
   * Start the media probe without touching the AI schema. The content
   * transaction owns both the Document CAS and its durable forward event;
   * the relay later creates the MEDIA_PROBE queue row idempotently.
   */
  async confirmMediaProbe(
    ownerId: string,
    id: string,
    selection: DocumentModelSelection,
    policyVersion: string,
    mediaLocator: DocumentPurgeLocator,
  ): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Document, {
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) return null;
      if (
        ![DocumentStatus.UPLOADED, DocumentStatus.FAILED].includes(current.status)
      ) {
        return current;
      }
      const canonicalMediaLocator = this.canonicalizeMediaPurgeLocator(mediaLocator);
      if (!this.isExactMediaPurgeLocator(canonicalMediaLocator, current, mediaLocator.bucket)) {
        throw new Error('Invalid confirmed media locator');
      }

      const persistedMediaLocator = this.mediaPurgeLocatorFromDocument(current, mediaLocator.bucket);
      if (persistedMediaLocator && !this.sameMediaPurgeLocator(persistedMediaLocator, canonicalMediaLocator!)) {
        throw new Error('Media source locator changed after persistence');
      }
      const sourceLocator = persistedMediaLocator ?? canonicalMediaLocator!;
      const probeGeneration = randomUUID();
      const started = await manager
        .createQueryBuilder()
        .update(Document)
        .set({
          errorCode: null,
          errorMessage: null,
          probeGeneration,
          probePolicyVersion: policyVersion,
          processingAttempt: () => '"processing_attempt" + 1',
          ...(persistedMediaLocator ? {} : {
            mediaSourceBucket: sourceLocator.bucket,
            mediaSourceVersionId: sourceLocator.versionId,
            mediaSourceEtag: sourceLocator.etag,
            mediaSourceContentLength: sourceLocator.contentLength,
          }),
          status: DocumentStatus.PROBING,
        })
        .where(
          'id = :id AND owner_id = :ownerId AND type IN (:...mediaTypes) AND status = :status',
          {
            id,
            mediaTypes: [DocumentType.AUDIO, DocumentType.VIDEO],
            ownerId,
            status: current.status,
          },
        )
        .execute();

      const updated = await manager.findOne(Document, { where: { id, ownerId } });

      if (started.affected === 1 && updated) {
        if (!updated.fullPipelineJobId?.trim() || Number(updated.processingAttempt) < 1) {
          throw new Error('Document processing identity is unavailable');
        }
        const fullPipelineJobId = updated.fullPipelineJobId;
        const outbox = new OutboxEvent();
        outbox.aggregateId = id;
        outbox.eventType = 'DocumentProbeRequested';
        outbox.payload = {
          documentId: id,
          fullPipelineJobId,
          processingAttempt: Number(updated.processingAttempt),
          ownerId,
          jobType: MEDIA_PROBE_JOB_TYPE,
          probeGeneration,
          policyVersion,
          deletionFence: Number(updated.deletionFence),
          sourceBucket: sourceLocator.bucket,
          sourceKey: sourceLocator.key,
          sourceVersionId: sourceLocator.versionId,
          sourceEtag: sourceLocator.etag,
          sourceContentLength: sourceLocator.contentLength,
          ...selection,
        };
        await manager.save(outbox);
      }

      return updated;
    });
  }

  async completeProbe(
    command: DocumentProbeCompletionCommand,
  ): Promise<DocumentProbeCompletionOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const versionId = normalizeStorageVersionId(command.locator.versionId);
      const etag = command.locator.etag.trim();
      if (!versionId || !etag) return 'IGNORED';
      const canonicalCommand: DocumentProbeCompletionCommand = {
        ...command,
        locator: {
          ...command.locator,
          etag,
          versionId,
        },
      };
      const document = await manager.findOne(Document, {
        where: { id: command.documentId, ownerId: command.ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) return 'IGNORED';
      if (
        Number(document.deletionFence) !== command.deletionFence ||
        document.probeGeneration !== command.probeGeneration ||
        document.probePolicyVersion !== command.policyVersion ||
        command.probeResultId.trim() === '' ||
        command.fullPipelineJobId.trim() === ''
      ) {
        return 'IGNORED';
      }

      if (command.durationSec <= 0 || !Number.isInteger(command.durationSec)) {
        throw new Error('Invalid media probe duration');
      }

      const [probeRequest] = await manager.query<readonly [ProbeRequestIdentity]>(
        `SELECT "payload"->>'fullPipelineJobId' AS "fullPipelineJobId"
                , "payload"->>'documentId' AS "documentId"
                , "payload"->>'ownerId' AS "ownerId"
                , "payload"->>'jobType' AS "jobType"
                , "payload"->>'probeGeneration' AS "probeGeneration"
                , "payload"->>'policyVersion' AS "policyVersion"
                , "payload"->>'deletionFence' AS "deletionFence"
                , "payload"->>'sourceBucket' AS "sourceBucket"
                , "payload"->>'sourceKey' AS "sourceKey"
                , "payload"->>'sourceVersionId' AS "sourceVersionId"
                , "payload"->>'sourceEtag' AS "sourceEtag"
                , ("payload"->>'sourceContentLength') AS "sourceContentLength"
         FROM "course"."outbox"
         WHERE "aggregate_id" = $1
           AND "event_type" = 'DocumentProbeRequested'
         ORDER BY "created_at" DESC, "id" DESC
         LIMIT 1`,
        [command.documentId],
      );
      if (!this.matchesProbeRequest(document, canonicalCommand, probeRequest)) {
        return 'IGNORED';
      }

      if (document.status !== DocumentStatus.PROBING) {
        return (document.status === DocumentStatus.PROCESSING || document.status === DocumentStatus.READY) &&
          await this.probeReceiptMatches(manager, canonicalCommand)
          ? 'ALREADY_APPLIED'
          : 'IGNORED';
      }

      if (!(await this.persistProbeReceipt(manager, document, canonicalCommand))) {
        return 'IGNORED';
      }

      const estimatedCredits = Number(document.estimatedCredits ?? 0);
      const isPlatformModel = document.modelSelectionKind === 'PLAN';
      const processingAttempt = Number(document.processingAttempt);
      if (!Number.isSafeInteger(processingAttempt) || processingAttempt < 1) {
        throw new Error('Invalid processing attempt');
      }
      if (isPlatformModel && estimatedCredits > 0) {
        const reserveKey = `reserve:${command.fullPipelineJobId}:${processingAttempt}`;
        const existingReservation = await manager.query<readonly { readonly id: string }[]>(
          'SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
          [reserveKey],
        );
        if (existingReservation.length === 0) {
          const wallet = await manager.query<readonly { readonly availableCredits: string }[]>(
            'SELECT "available_credits" AS "availableCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1 FOR UPDATE',
            [command.ownerId],
          );
          if (Number(wallet[0]?.availableCredits ?? 0) < estimatedCredits) {
            throw new BudgetExhaustedError();
          }
          await manager.query(
            'UPDATE "course"."owner_credit_wallets" SET "available_credits" = "available_credits" - $2, "reserved_credits" = "reserved_credits" + $2, "updated_at" = now() WHERE "owner_id" = $1',
            [command.ownerId, estimatedCredits],
          );
          await manager.query(
            'INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, \'RESERVE\', $5)',
            [command.ownerId, command.fullPipelineJobId, processingAttempt, reserveKey, estimatedCredits],
          );
        }
      }

      await manager.update(
        Document,
        { id: command.documentId, ownerId: command.ownerId, status: DocumentStatus.PROBING },
        {
          durationSec: command.durationSec,
          budgetStatus: isPlatformModel ? 'RESERVED' : 'CUSTOM_ZERO_COST',
          status: DocumentStatus.PROCESSING,
        },
      );

      const outbox = new OutboxEvent();
      outbox.aggregateId = command.documentId;
      outbox.eventType = 'DocumentReadyForProcessing';
      outbox.payload = {
        customModelConfigId: document.customModelConfigId,
        documentId: command.documentId,
        jobType: JobType.FULL_PIPELINE,
        kind: document.modelSelectionKind,
        ownerId: command.ownerId,
        platformModelId: document.platformModelId,
        fullPipelineJobId: command.fullPipelineJobId,
        probeResultId: command.probeResultId,
        probeGeneration: command.probeGeneration,
        policyVersion: command.policyVersion,
        deletionFence: command.deletionFence,
        processingAttempt,
      };
      await manager.save(outbox);

      return 'APPLIED';
    });
  }

  private matchesProbeRequest(
    document: Document,
    command: DocumentProbeCompletionCommand,
    request: ProbeRequestIdentity | undefined,
  ): boolean {
    return request?.documentId === command.documentId &&
      request.ownerId === command.ownerId &&
      request.jobType === MEDIA_PROBE_JOB_TYPE &&
      request.fullPipelineJobId === command.fullPipelineJobId &&
      request.probeGeneration === command.probeGeneration &&
      request.policyVersion === command.policyVersion &&
      request.deletionFence === String(command.deletionFence) &&
      request.sourceBucket === command.locator.bucket &&
      request.sourceKey === command.locator.key &&
      normalizeStorageVersionId(request.sourceVersionId) === command.locator.versionId &&
      request.sourceEtag === command.locator.etag &&
      request.sourceContentLength === String(command.locator.contentLength) &&
      document.mediaSourceBucket === command.locator.bucket &&
      normalizeStorageVersionId(document.mediaSourceVersionId) === command.locator.versionId &&
      document.mediaSourceEtag === command.locator.etag &&
      Number(document.mediaSourceContentLength) === command.locator.contentLength &&
      document.storageRef === command.locator.key &&
      Number(document.sizeBytes) === command.locator.contentLength;
  }

  private async persistProbeReceipt(
    manager: EntityManager,
    document: Document,
    command: DocumentProbeCompletionCommand,
  ): Promise<boolean> {
    await manager.query(
      `INSERT INTO "course"."document_probe_receipts"
         ("probe_result_id", "document_id", "owner_id", "full_pipeline_job_id",
          "probe_generation", "policy_version", "deletion_fence", "duration_sec",
          "source_bucket", "source_key", "source_version_id", "source_etag",
          "source_content_length")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING`,
      [
        command.probeResultId,
        command.documentId,
        command.ownerId,
        command.fullPipelineJobId,
        command.probeGeneration,
        command.policyVersion,
        command.deletionFence,
        command.durationSec,
        command.locator.bucket,
        command.locator.key,
        command.locator.versionId,
        command.locator.etag,
        command.locator.contentLength,
      ],
    );
    return this.probeReceiptMatches(manager, command);
  }

  private async probeReceiptMatches(
    manager: EntityManager,
    command: DocumentProbeCompletionCommand,
  ): Promise<boolean> {
    const [receipt] = await manager.query<readonly [ProbeReceiptIdentity]>(
      `SELECT "probe_result_id" AS "probeResultId",
              "document_id" AS "documentId",
              "owner_id" AS "ownerId",
              "full_pipeline_job_id" AS "fullPipelineJobId",
              "probe_generation" AS "probeGeneration",
              "policy_version" AS "policyVersion",
              "deletion_fence" AS "deletionFence",
              "duration_sec" AS "durationSec",
              "source_bucket" AS "sourceBucket",
              "source_key" AS "sourceKey",
              "source_version_id" AS "sourceVersionId",
              "source_etag" AS "sourceEtag",
              "source_content_length" AS "sourceContentLength"
       FROM "course"."document_probe_receipts"
       WHERE "probe_result_id" = $1
          OR "full_pipeline_job_id" = $2
          OR ("document_id" = $3 AND "probe_generation" = $4 AND "policy_version" = $5)
       ORDER BY "created_at" DESC
       LIMIT 1
       FOR UPDATE`,
      [
        command.probeResultId,
        command.fullPipelineJobId,
        command.documentId,
        command.probeGeneration,
        command.policyVersion,
      ],
    );
    if (!receipt) return false;
    return receipt.probeResultId === command.probeResultId &&
      receipt.documentId === command.documentId &&
      receipt.ownerId === command.ownerId &&
      receipt.fullPipelineJobId === command.fullPipelineJobId &&
      receipt.probeGeneration === command.probeGeneration &&
      receipt.policyVersion === command.policyVersion &&
      Number(receipt.deletionFence) === command.deletionFence &&
      Number(receipt.durationSec) === command.durationSec &&
      receipt.sourceBucket === command.locator.bucket &&
      receipt.sourceKey === command.locator.key &&
      normalizeStorageVersionId(receipt.sourceVersionId) === command.locator.versionId &&
      receipt.sourceEtag === command.locator.etag &&
      Number(receipt.sourceContentLength) === command.locator.contentLength;
  }

  async failProbe(
    command: DocumentProbeFailureCommand,
  ): Promise<DocumentProbeFailureOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id: command.documentId, ownerId: command.ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) return 'IGNORED';

      const matchesCurrentProbe =
        Number(document.deletionFence) === command.deletionFence &&
        document.probeGeneration === command.probeGeneration &&
        document.probePolicyVersion === command.policyVersion;
      if (document.status === DocumentStatus.FAILED && matchesCurrentProbe) {
        return 'ALREADY_APPLIED';
      }
      if (document.status !== DocumentStatus.PROBING || !matchesCurrentProbe) {
        return 'IGNORED';
      }

      await manager.update(
        Document,
        {
          id: command.documentId,
          ownerId: command.ownerId,
          status: DocumentStatus.PROBING,
          probeGeneration: command.probeGeneration,
          probePolicyVersion: command.policyVersion,
          deletionFence: command.deletionFence,
        },
        {
          errorCode: command.errorCode,
          errorMessage: command.errorMessage,
          status: DocumentStatus.FAILED,
        },
      );

      return 'APPLIED';
    });
  }

  /** Returns null when this retry did not win the FAILED -> PROCESSING CAS. */
  async retryProcessing(
    ownerId: string,
    id: string,
    selection: DocumentModelSelection,
  ): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const started = await this.startProcessing(manager, ownerId, id, [DocumentStatus.FAILED]);
      if (!started) {
        return null;
      }

      const document = await manager.findOneByOrFail(Document, { id, ownerId });
      await this.enqueueProcessing(
        manager,
        ownerId,
        id,
        selection,
        Number(document.deletionFence),
        document.fullPipelineJobId,
        Number(document.processingAttempt),
      );
      return manager.findOne(Document, { where: { id, ownerId } });
    });
  }

  async projectProcessingResult(
    command: DocumentStatusProjectionCommand,
  ): Promise<DocumentStatusProjectionOutcome> {
    // The result carries the AI attempt/lease fence and durable run correlation;
    // the latest same-schema request is the content-owned current-run marker.
    const result = await this.createQueryBuilder()
      .update(Document)
      .set({
        errorCode: command.errorCode,
        errorMessage: command.errorMessage,
        budgetStatus: () =>
          'COALESCE(CAST(:budgetStatus AS varchar), "budget_status")',
        estimatedCredits: () =>
          'CASE WHEN CAST(:estimateStatus AS varchar) IS NULL THEN "estimated_credits" ELSE CAST(:estimatedCredits AS bigint) END',
        estimateStatus: () =>
          'COALESCE(CAST(:estimateStatus AS varchar), "estimate_status")',
        settledCredits: command.settledCredits,
        status: command.status,
      })
      .where(
        `id = :documentId AND owner_id = :ownerId
         AND (
           status = :processingStatus
           OR (
             status = :readyStatus
             AND :status = :failedStatus
           )
         )
         AND (
           (
             CAST(:attempt AS integer) IS NOT NULL
             AND CAST(:leaseId AS uuid) IS NOT NULL
             AND (
               NOT EXISTS (
                 SELECT 1
                 FROM "course"."outbox" AS "request"
                 WHERE "request"."aggregate_id" = :documentId
                   AND "request"."event_type" = 'DocumentReadyForProcessing'
               )
               OR (
                 SELECT "request"."created_at"
                 FROM "course"."outbox" AS "request"
                 WHERE "request"."aggregate_id" = :documentId
                   AND "request"."event_type" = 'DocumentReadyForProcessing'
                 ORDER BY "request"."created_at" DESC, "request"."id" DESC
                 LIMIT 1
               ) <= :eventCreatedAt
               )
             )
           OR (
             :attempt IS NULL
             AND :leaseId IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM "course"."outbox" AS "request"
               WHERE "request"."aggregate_id" = :documentId
                 AND "request"."event_type" = 'DocumentReadyForProcessing'
             )
           )
         )`,
        {
          attempt: command.attempt,
          documentId: command.documentId,
          eventCreatedAt: command.eventCreatedAt,
          leaseId: command.leaseId,
          ownerId: command.ownerId,
          processingStatus: DocumentStatus.PROCESSING,
          readyStatus: DocumentStatus.READY,
          failedStatus: DocumentStatus.FAILED,
          status: command.status,
          budgetStatus: command.budgetStatus,
          estimatedCredits: command.estimatedCredits,
          estimateStatus: command.estimateStatus,
        },
      )
      .execute();

    if (result.affected === 1) return 'APPLIED';

    const [current] = await this.query<readonly ProjectionStateRow[]>(
      `SELECT "document"."status" AS "status",
              "request"."created_at" AS "latestRequestCreatedAt"
       FROM "course"."documents" AS "document"
       LEFT JOIN LATERAL (
         SELECT "request"."created_at"
         FROM "course"."outbox" AS "request"
         WHERE "request"."aggregate_id" = "document"."id"
           AND "request"."event_type" = 'DocumentReadyForProcessing'
         ORDER BY "request"."created_at" DESC, "request"."id" DESC
         LIMIT 1
       ) AS "request" ON TRUE
       WHERE "document"."id" = $1
         AND "document"."owner_id" = $2`,
      [command.documentId, command.ownerId],
    );

    if (command.attempt === null && command.leaseId === null) {
      if (!current || current.latestRequestCreatedAt === null) return 'IGNORED';
      return 'UNVERIFIED_LEGACY';
    }

    if (!current) return 'IGNORED';
    if (
      current.latestRequestCreatedAt !== null &&
      current.latestRequestCreatedAt.getTime() > command.eventCreatedAt.getTime()
    ) {
      return 'IGNORED';
    }
    if (current.status === command.status) return 'ALREADY_APPLIED';

    return 'IGNORED';
  }

  private async startProcessing(
    manager: EntityManager,
    ownerId: string,
    id: string,
    allowedStatuses: readonly DocumentStatus[],
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(Document)
      .set({
        errorCode: null,
        errorMessage: null,
        processingAttempt: () => '"processing_attempt" + 1',
        status: DocumentStatus.PROCESSING,
      })
      .where('id = :id AND owner_id = :ownerId AND status IN (:...allowed)', {
        id,
        ownerId,
        allowed: allowedStatuses,
      })
      .execute();

    return result.affected === 1;
  }

  private async enqueueProcessing(
    manager: EntityManager,
    ownerId: string,
    id: string,
    selection: DocumentModelSelection,
    deletionFence: number,
    fullPipelineJobId: string,
    processingAttempt: number,
  ): Promise<void> {
    const outbox = new OutboxEvent();
    outbox.aggregateId = id;
    outbox.eventType = 'DocumentReadyForProcessing';
    outbox.payload = {
      documentId: id,
      deletionFence,
      ownerId,
      jobType: 'FULL_PIPELINE',
      fullPipelineJobId,
      processingAttempt,
      ...selection,
    };
    await manager.save(outbox);
  }
}

interface ProjectionStateRow {
  readonly latestRequestCreatedAt: Date | null;
  readonly status: DocumentStatus;
}

interface ProbeRequestIdentity {
  readonly deletionFence: string | null;
  readonly documentId: string | null;
  readonly fullPipelineJobId: string | null;
  readonly jobType: string | null;
  readonly ownerId: string | null;
  readonly policyVersion: string | null;
  readonly probeGeneration: string | null;
  readonly sourceBucket: string | null;
  readonly sourceContentLength: string | null;
  readonly sourceEtag: string | null;
  readonly sourceKey: string | null;
  readonly sourceVersionId: string | null;
}

interface ProbeReceiptIdentity {
  readonly deletionFence: string | number;
  readonly documentId: string;
  readonly fullPipelineJobId: string;
  readonly ownerId: string;
  readonly policyVersion: string;
  readonly probeGeneration: string;
  readonly probeResultId: string;
  readonly durationSec: string | number;
  readonly sourceBucket: string;
  readonly sourceKey: string;
  readonly sourceVersionId: string;
  readonly sourceEtag: string;
  readonly sourceContentLength: string | number;
}

export interface DocumentStorageBuckets {
  readonly documents: string;
  readonly media: string;
}

interface DocumentEventIdentity {
  readonly fullPipelineJobId?: string;
  readonly policyVersion?: string;
  readonly processingAttempt?: number;
  readonly probeGeneration?: string;
  readonly requireProbeIdentity?: boolean;
}
