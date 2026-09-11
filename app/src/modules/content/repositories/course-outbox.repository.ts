import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';

import { DateTimeUtil } from '../../../common/datetime.util';
import { BaseRepository } from '../../../database/base.repository';
import { OutboxEvent } from '../entities/outbox-event.entity';

@Injectable()
export class CourseOutboxRepository extends BaseRepository<OutboxEvent> {
  constructor(dataSource: DataSource) {
    super(OutboxEvent, dataSource);
  }

  async findUnpublished(limit: number): Promise<OutboxEvent[]> {
    return this.find({
      // Purge events belong to the future physical-purge consumer. Leaving
      // them pending keeps the handoff durable without feeding them to the
      // content -> AI forward relay.
      where: { eventType: Not('DocumentPurgeRequested'), publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.update({ id }, { publishedAt: DateTimeUtil.nowUtc() });
  }
}
