import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

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
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markPublished(id: string): Promise<void> {
    await this.update({ id }, { publishedAt: DateTimeUtil.nowUtc() });
  }
}
