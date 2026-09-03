import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { CreateUploadUrlCommand } from '../contracts/create-upload-url.command';
import {
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from '../contracts/document-status-projection.port';
import { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { OutboxEvent } from '../entities/outbox-event.entity';
import type { DocumentModelSelection } from '../../ai/contracts/model-selection.contracts';

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
        await this.enqueueProcessing(manager, ownerId, id, selection);
      }

      return manager.findOne(Document, { where: { id, ownerId } });
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

      await this.enqueueProcessing(manager, ownerId, id, selection);
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
  ): Promise<void> {
    const outbox = new OutboxEvent();
    outbox.aggregateId = id;
    outbox.eventType = 'DocumentReadyForProcessing';
    outbox.payload = {
      documentId: id,
      ownerId,
      jobType: 'FULL_PIPELINE',
      ...selection,
    };
    await manager.save(outbox);
  }
}

interface ProjectionStateRow {
  readonly latestRequestCreatedAt: Date | null;
  readonly status: DocumentStatus;
}
