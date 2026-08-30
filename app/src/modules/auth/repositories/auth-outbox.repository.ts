import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';

import { DateTimeUtil } from '../../../common/datetime.util';
import { BaseRepository } from '../../../database/base.repository';
import { AuthOutboxEvent } from '../entities/auth-outbox-event.entity';

const ACCOUNT_ACCESS_REVOKED_EVENT = 'AccountAccessRevoked';

@Injectable()
export class AuthOutboxRepository extends BaseRepository<AuthOutboxEvent> {
  constructor(dataSource: DataSource) {
    super(AuthOutboxEvent, dataSource);
  }

  async findUnpublishedAccountAccessRevocations(limit: number): Promise<AuthOutboxEvent[]> {
    return this.find({
      where: {
        eventType: ACCOUNT_ACCESS_REVOKED_EVENT,
        publishedAt: IsNull(),
      },
      order: { createdAt: 'ASC', id: 'ASC' },
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
