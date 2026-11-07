import type { EntityManager } from 'typeorm';

/** Result of settling one reservation. The business keys make every outcome idempotent per `reserve:{job}:{attempt}`. */
export type ReservationSettlementOutcome =
  | { readonly kind: 'NO_RESERVATION' }
  | {
    readonly kind: 'SETTLED' | 'ALREADY_SETTLED';
    /** Credits actually consumed (the SETTLE ledger amount). */
    readonly settledCredits: number;
    /** True when part of the reservation stays HELD because the provider dispatch outcome is unknown (ADR-0022). */
    readonly isHeld: boolean;
  };

export interface SettleReservationInput {
  readonly hasUncertainDispatch: boolean;
  readonly jobId: string;
  readonly knownActualCredits: number;
  readonly ownerId: string;
  /**
   * The Document's processing attempt that created the reservation. It MUST be the same value used by the reserve
   * key; the Go queue attempt grows on every technical retry and must never be used here.
   */
  readonly processingAttempt: number;
}

const INSERT_LEDGER_ENTRY = 'INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, $5, $6)';

/**
 * Settle the actual usage of a reservation and release (or hold) the remainder inside the caller's transaction.
 *
 *   reserve:{job}:{processingAttempt}  ->  settle:{job}:{processingAttempt}
 *                                          release:{job}:{processingAttempt}   (known outcome: reserved - actual)
 *                                          hold:{job}:{processingAttempt}      (uncertain dispatch: reserved - known)
 *
 * No RESERVE row means nothing was reserved (PDF/TXT on the Go path, Custom AI): the call is a no-op so credits can
 * never be charged without a reservation. A repeated call returns the recorded outcome and writes nothing.
 *
 * Known overshoot: actual usage above the reservation is settled in full, so the wallet can go negative (same as the
 * legacy settleBudget). Accepted for now; credits are redesigned around real cost in #268.
 */
export async function settleReservation(manager: EntityManager, input: SettleReservationInput): Promise<ReservationSettlementOutcome> {
  const { jobId, ownerId, processingAttempt } = input;
  const settleKey = `settle:${jobId}:${processingAttempt}`;
  const existing = await manager.query<readonly { readonly credits: string }[]>(
    'SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
    [settleKey],
  );
  if (existing.length > 0) {
    const holds = await manager.query<readonly { readonly id: string }[]>(
      'SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
      [`hold:${jobId}:${processingAttempt}`],
    );
    return { isHeld: holds.length > 0, kind: 'ALREADY_SETTLED', settledCredits: Number(existing[0]?.credits ?? 0) };
  }
  const reserve = await manager.query<readonly { readonly credits: string }[]>(
    'SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
    [`reserve:${jobId}:${processingAttempt}`],
  );
  if (reserve.length === 0) return { kind: 'NO_RESERVATION' };
  const reserved = Number(reserve[0]?.credits ?? 0);
  const released = input.hasUncertainDispatch ? 0 : Math.max(0, reserved - input.knownActualCredits);
  const held = input.hasUncertainDispatch ? Math.max(0, reserved - input.knownActualCredits) : 0;
  await manager.query(INSERT_LEDGER_ENTRY, [ownerId, jobId, processingAttempt, settleKey, 'SETTLE', input.knownActualCredits]);
  await manager.query(INSERT_LEDGER_ENTRY, [ownerId, jobId, processingAttempt, `release:${jobId}:${processingAttempt}`, 'RELEASE', released]);
  if (held > 0) await manager.query(INSERT_LEDGER_ENTRY, [ownerId, jobId, processingAttempt, `hold:${jobId}:${processingAttempt}`, 'HOLD', held]);
  await manager.query(
    'UPDATE "course"."owner_credit_wallets" SET "reserved_credits" = "reserved_credits" - $2, "available_credits" = "available_credits" + $3 - $4, "updated_at" = now() WHERE "owner_id" = $1',
    [ownerId, reserved, released, Math.max(0, input.knownActualCredits - reserved)],
  );
  return { isHeld: held > 0, kind: 'SETTLED', settledCredits: input.knownActualCredits };
}
