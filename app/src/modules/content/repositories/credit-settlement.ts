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
    const ledgerKeys = await manager.query<readonly { readonly businessKey: string }[]>(
      'SELECT "business_key" AS "businessKey" FROM "course"."credit_ledger_entries" WHERE "business_key" = ANY($1::text[])',
      [[`hold:${jobId}:${processingAttempt}`, `hold-release:${jobId}:${processingAttempt}`]],
    );
    const keys = new Set(ledgerKeys.map((row) => row.businessKey));
    // A HOLD that was auto-released is no longer held: a replay must not flip the Document back to HELD.
    const isHeld = keys.has(`hold:${jobId}:${processingAttempt}`) && !keys.has(`hold-release:${jobId}:${processingAttempt}`);
    return { isHeld, kind: 'ALREADY_SETTLED', settledCredits: Number(existing[0]?.credits ?? 0) };
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

export interface ReleaseExpiredHoldInput {
  readonly jobId: string;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

export type ExpiredHoldReleaseOutcome =
  | { readonly kind: 'RELEASED'; readonly credits: number; readonly documentId: string | null }
  | { readonly kind: 'ALREADY_RELEASED' | 'NO_HOLD' | 'SKIPPED_LOCKED' };

/**
 * Give an unresolved HOLD back to the wallet after the owner-approved wait (`hold-release:{job}:{attempt}`).
 * HOLD subtracted the amount from `reserved_credits` without crediting `available_credits`, so release only
 * adds it to `available_credits`. The Document row is locked first (SKIP LOCKED: a busy Document is retried on the
 * next run), then the wallet; a Document that no longer exists locks the wallet directly. Idempotent per key.
 */
export async function releaseExpiredHold(manager: EntityManager, input: ReleaseExpiredHoldInput): Promise<ExpiredHoldReleaseOutcome> {
  const { jobId, ownerId, processingAttempt } = input;
  const lock = await lockDocumentOrWallet(manager, { jobId, ownerId });
  if (lock.kind === 'LOCKED_BY_OTHER') return { kind: 'SKIPPED_LOCKED' };
  const holds = await manager.query<readonly { readonly credits: string }[]>(
    'SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
    [`hold:${jobId}:${processingAttempt}`],
  );
  if (holds.length === 0) return { kind: 'NO_HOLD' };
  const held = Number(holds[0]?.credits ?? 0);
  const inserted = await manager.query<readonly { readonly id: string }[]>(
    'INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, \'RELEASE\', $5) ON CONFLICT ("business_key") DO NOTHING RETURNING "id"',
    [ownerId, jobId, processingAttempt, `hold-release:${jobId}:${processingAttempt}`, held],
  );
  if (inserted.length === 0) return { kind: 'ALREADY_RELEASED' };
  await manager.query(
    'UPDATE "course"."owner_credit_wallets" SET "available_credits" = "available_credits" + $2, "updated_at" = now() WHERE "owner_id" = $1',
    [ownerId, held],
  );
  const documentId = lock.documentId;
  if (documentId !== null) {
    await manager.query(
      'UPDATE "course"."documents" SET "budget_status" = \'SETTLED\' WHERE "id" = $1 AND "full_pipeline_job_id" = $2 AND "processing_attempt" = $3 AND "budget_status" = \'HELD\'',
      [documentId, jobId, processingAttempt],
    );
  }
  return { credits: held, documentId, kind: 'RELEASED' };
}

export type DocumentOrWalletLock =
  | { readonly kind: 'LOCKED'; readonly documentId: string | null }
  | { readonly kind: 'LOCKED_BY_OTHER' };

/** Document -> wallet lock order. `SKIP LOCKED` hides a busy row, so existence is checked without a lock first. */
export async function lockDocumentOrWallet(
  manager: EntityManager,
  input: { readonly jobId: string; readonly ownerId: string },
): Promise<DocumentOrWalletLock> {
  const existing = await manager.query<readonly { readonly id: string }[]>(
    'SELECT "id" FROM "course"."documents" WHERE "owner_id" = $1 AND "full_pipeline_job_id" = $2',
    [input.ownerId, input.jobId],
  );
  if (existing.length === 0) {
    await manager.query('SELECT 1 FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1 FOR UPDATE', [input.ownerId]);
    return { documentId: null, kind: 'LOCKED' };
  }
  const locked = await manager.query<readonly { readonly id: string }[]>(
    'SELECT "id" FROM "course"."documents" WHERE "owner_id" = $1 AND "full_pipeline_job_id" = $2 FOR UPDATE SKIP LOCKED',
    [input.ownerId, input.jobId],
  );
  const documentId = locked[0]?.id;
  return documentId === undefined ? { kind: 'LOCKED_BY_OTHER' } : { documentId, kind: 'LOCKED' };
}

export interface ReserveCreditsInput {
  readonly estimatedCredits: number;
  readonly jobId: string;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

export type ReserveCreditsOutcome =
  | { readonly kind: 'RESERVED' | 'ALREADY_RESERVED' }
  | { readonly kind: 'INSUFFICIENT'; readonly availableCredits: number };

/**
 * Reserve credits for `reserve:{job}:{processingAttempt}` inside the caller's transaction. The caller must already
 * hold the Document row lock (Document -> wallet order). A repeated call finds the RESERVE row and writes nothing.
 * Never throws for a short balance: the caller decides whether that rolls back or is recorded.
 */
export async function reserveCredits(manager: EntityManager, input: ReserveCreditsInput): Promise<ReserveCreditsOutcome> {
  const { estimatedCredits, jobId, ownerId, processingAttempt } = input;
  const reserveKey = `reserve:${jobId}:${processingAttempt}`;
  const existing = await manager.query<readonly { readonly id: string }[]>(
    'SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
    [reserveKey],
  );
  if (existing.length > 0) return { kind: 'ALREADY_RESERVED' };
  const wallet = await manager.query<readonly { readonly availableCredits: string }[]>(
    'SELECT "available_credits" AS "availableCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1 FOR UPDATE',
    [ownerId],
  );
  const availableCredits = Number(wallet[0]?.availableCredits ?? 0);
  if (availableCredits < estimatedCredits) return { availableCredits, kind: 'INSUFFICIENT' };
  await manager.query(
    'UPDATE "course"."owner_credit_wallets" SET "available_credits" = "available_credits" - $2, "reserved_credits" = "reserved_credits" + $2, "updated_at" = now() WHERE "owner_id" = $1',
    [ownerId, estimatedCredits],
  );
  await manager.query(INSERT_LEDGER_ENTRY, [ownerId, jobId, processingAttempt, reserveKey, 'RESERVE', estimatedCredits]);
  return { kind: 'RESERVED' };
}
