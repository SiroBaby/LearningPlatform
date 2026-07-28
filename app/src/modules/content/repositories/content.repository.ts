import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { CreateUploadUrlCommand } from '../contracts/create-upload-url.command';
import { DocumentStatusProjectionCommand } from '../contracts/document-status-projection.port';
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
          allowed: [DocumentStatus.UPLOADED, DocumentStatus.FAILED],
        })
        .execute();

      if (result.affected) {
        const outbox = new OutboxEvent();
        outbox.aggregateId = id;
        outbox.eventType = 'DocumentReadyForProcessing';
        outbox.payload = { documentId: id, ownerId, jobType: 'FULL_PIPELINE', ...selection };
        await manager.save(outbox);
      }

      return manager.findOne(Document, { where: { id, ownerId } });
    });
  }

  async projectProcessingResult(
    command: DocumentStatusProjectionCommand,
  ): Promise<void> {
    await this.createQueryBuilder()
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
        'id = :documentId AND owner_id = :ownerId AND status = :processingStatus',
        {
          documentId: command.documentId,
          ownerId: command.ownerId,
          processingStatus: DocumentStatus.PROCESSING,
          budgetStatus: command.budgetStatus,
          estimatedCredits: command.estimatedCredits,
          estimateStatus: command.estimateStatus,
        },
      )
      .execute();
  }
}
