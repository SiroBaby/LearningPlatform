import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

import {
  ACCOUNT_ACCESS_REVOCATION,
  type AccountAccessRevocation,
  type AccountAccessRevocationReason,
} from '../modules/ai/contracts/account-access-revocation.port';
import { AuthOutboxRepository } from '../modules/auth/repositories/auth-outbox.repository';

const ACCOUNT_ACCESS_REVOKED_EVENT = 'AccountAccessRevoked';
const ACCOUNT_ACCESS_REVOCATION_REASONS = new Set<AccountAccessRevocationReason>([
  'ACCOUNT_DELETED',
  'ACCOUNT_SUSPENDED',
]);

@Injectable()
export class AuthCancellationRelay {
  constructor(
    private readonly outbox: AuthOutboxRepository,
    @Inject(ACCOUNT_ACCESS_REVOCATION)
    private readonly revocations: AccountAccessRevocation,
  ) {}

  async pump(limit: number): Promise<void> {
    const pending = await this.outbox.findUnpublishedAccountAccessRevocations(limit);

    for (const row of pending) {
      const event = this.parse(row);
      await this.revocations.apply(event);
      await this.outbox.markPublished(row.id);
    }
  }

  private parse(row: {
    readonly aggregateId: string;
    readonly eventType: string;
    readonly idempotencyKey: string;
    readonly payload: unknown;
  }): {
    readonly eventIdempotencyKey: string;
    readonly reasonCode: AccountAccessRevocationReason;
    readonly userId: string;
  } {
    if (
      row.eventType !== ACCOUNT_ACCESS_REVOKED_EVENT ||
      !isUuid(row.aggregateId) ||
      row.idempotencyKey.trim().length === 0 ||
      row.idempotencyKey.length > 128
    ) {
      throw new Error('Invalid account access revocation event');
    }

    const payload = row.payload;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid account access revocation event');
    }
    const userId = (payload as Record<string, unknown>).userId;
    const reason = (payload as Record<string, unknown>).reason;
    if (
      typeof userId !== 'string' ||
      !isUuid(userId) ||
      userId !== row.aggregateId ||
      typeof reason !== 'string' ||
      !ACCOUNT_ACCESS_REVOCATION_REASONS.has(reason as AccountAccessRevocationReason)
    ) {
      throw new Error('Invalid account access revocation event');
    }

    return {
      eventIdempotencyKey: row.idempotencyKey,
      reasonCode: reason as AccountAccessRevocationReason,
      userId,
    };
  }
}
