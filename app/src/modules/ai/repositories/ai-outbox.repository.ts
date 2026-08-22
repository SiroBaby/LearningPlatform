import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { DateTimeUtil } from '../../../common/datetime.util';
import { BaseRepository } from '../../../database/base.repository';
import { DOCUMENT_PROCESSING_RESULT_EVENT } from '../contracts/document-processing-result';
import { AiOutboxEvent } from '../entities/ai-outbox-event.entity';

@Injectable()
export class AiOutboxRepository extends BaseRepository<AiOutboxEvent> {
  constructor(dataSource: DataSource) {
    super(AiOutboxEvent, dataSource);
  }

  async findUnpublishedProcessingResults(limit: number): Promise<AiOutboxEvent[]> {
    return this.find({
      where: {
        eventType: DOCUMENT_PROCESSING_RESULT_EVENT,
        publishedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.update(
      { id, publishedAt: IsNull() },
      { publishedAt: DateTimeUtil.nowUtc() },
    );
  }
}
