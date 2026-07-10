import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { CreateUploadUrlCommand } from '../contracts/create-upload-url.command';
import { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { OutboxEvent } from '../entities/outbox-event.entity';

@Injectable()
export class ContentRepository extends BaseRepository<Document> {
  constructor(private readonly dataSource: DataSource) {
    super(Document, dataSource);
  }

  async createUploaded(
    ownerId: string,
    command: CreateUploadUrlCommand,
    storageRef: string,
  ): Promise<Document> {
    const document = this.create({
      ownerId,
      type: command.type,
      originalName: command.originalName,
      storageRef,
      sizeBytes: command.sizeBytes,
      status: DocumentStatus.UPLOADED,
    });

    return this.save(document);
  }

  async findByOwnerId(ownerId: string, id: string): Promise<Document | null> {
    return this.findOne({ where: { id, ownerId } });
  }

  async confirmProcessing(ownerId: string, id: string): Promise<Document | null> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(Document)
        .set({ status: DocumentStatus.PROCESSING })
        .where('id = :id AND owner_id = :ownerId AND status IN (:...allowed)', {
          id,
          ownerId,
          allowed: [DocumentStatus.UPLOADED, DocumentStatus.FAILED],
        })
        .execute();

      if (result.affected) {
        await manager.insert(OutboxEvent, {
          aggregateId: id,
          eventType: 'DocumentReadyForProcessing',
          payload: { documentId: id, ownerId, jobType: 'FULL_PIPELINE' },
        });
      }

      return manager.findOne(Document, { where: { id, ownerId } });
    });
  }
}
