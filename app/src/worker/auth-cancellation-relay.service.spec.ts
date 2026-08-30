import { describe, expect, it, jest } from '@jest/globals';

import type { AccountAccessRevocation } from '../modules/ai/contracts/account-access-revocation.port';
import type { AuthOutboxEvent } from '../modules/auth/entities/auth-outbox-event.entity';
import type { AuthOutboxRepository } from '../modules/auth/repositories/auth-outbox.repository';
import { AuthCancellationRelay } from './auth-cancellation-relay.service';

const userId = '00000000-0000-4000-8000-000000000001';

function event(overrides: Partial<AuthOutboxEvent> = {}): AuthOutboxEvent {
  return {
    aggregateId: userId,
    createdAt: new Date(),
    eventType: 'AccountAccessRevoked',
    id: '1',
    idempotencyKey: `${userId}:ACCOUNT_SUSPENDED`,
    payload: { reason: 'ACCOUNT_SUSPENDED', userId },
    publishedAt: null,
    ...overrides,
  };
}

function relayFor(rows: AuthOutboxEvent[], apply = jest.fn<AccountAccessRevocation['apply']>()) {
  const outbox = {
    findUnpublishedAccountAccessRevocations: jest.fn(async () => rows),
    markPublished: jest.fn(async (_id: string) => undefined),
  };
  return {
    apply,
    outbox,
    relay: new AuthCancellationRelay(
      outbox as unknown as AuthOutboxRepository,
      { apply } as unknown as AccountAccessRevocation,
    ),
  };
}

describe('AuthCancellationRelay', () => {
  it('applies a validated event before acknowledging the auth outbox row', async () => {
    const fixture = relayFor([event()]);

    await fixture.relay.pump(10);

    expect(fixture.apply).toHaveBeenCalledWith({
      eventIdempotencyKey: `${userId}:ACCOUNT_SUSPENDED`,
      reasonCode: 'ACCOUNT_SUSPENDED',
      userId,
    });
    expect(fixture.outbox.markPublished).toHaveBeenCalledWith('1');
    expect(fixture.apply.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.outbox.markPublished.mock.invocationCallOrder[0],
    );
  });

  it('does not acknowledge an invalid event', async () => {
    const fixture = relayFor([event({
      payload: { reason: 'ACCOUNT_SUSPENDED', userId: '00000000-0000-4000-8000-000000000002' },
    })]);

    await expect(fixture.relay.pump(10)).rejects.toThrow('Invalid account access revocation event');
    expect(fixture.apply).not.toHaveBeenCalled();
    expect(fixture.outbox.markPublished).not.toHaveBeenCalled();
  });

  it('keeps the event unpublished when the AI cancellation write fails', async () => {
    const apply = jest.fn<AccountAccessRevocation['apply']>().mockRejectedValue(new Error('ai unavailable'));
    const fixture = relayFor([event()], apply);

    await expect(fixture.relay.pump(10)).rejects.toThrow('ai unavailable');
    expect(fixture.outbox.markPublished).not.toHaveBeenCalled();
  });
});
