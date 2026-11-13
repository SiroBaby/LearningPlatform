import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import {
  PROCESSING_SETTLEMENT_FACTS,
  type ProcessingSettlementFactsPort,
} from '../../ai/contracts/processing-settlement-facts.port';
import type {
  CreditReconciliationLock,
  ExpiredHoldCandidate,
  ExpiredHoldReleaseResult,
  OrphanReservationCandidate,
  OrphanReservationCursor,
  ReconciledDocument,
  ReservationEvaluationContext,
  ReservationReconcileResult,
  ReservationVerdict,
} from '../contracts/credit-reconciliation.contracts';
import { Document } from '../entities/document.entity';
import { lockDocumentOrWallet, releaseExpiredHold, settleReservation } from './credit-settlement';

/** Fixed advisory-lock name; one reconciler runs per database at a time. */
const RECONCILER_LOCK_NAME = 'credit-reconciler';

interface CandidateRow {
  readonly createdAt: Date;
  readonly createdAtCursor: string;
  readonly credits: string;
  readonly id: string;
  readonly jobId: string;
  readonly nextAttemptReservedAt?: Date | null;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

interface DocumentRow {
  readonly id: string;
  readonly platformModelId: string | null;
  readonly processingAttempt: string;
  readonly status: ReconciledDocument['status'];
  readonly updatedAt: Date;
}

/** Thrown inside the transaction on a dry run so every write is rolled back after the outcome was computed. */
class DryRunRollback extends Error {
  constructor(readonly result: ReservationReconcileResult) {
    super('Credit reconciler dry run');
  }
}

/**
 * All `course.*` SQL of the credit reconciler. The AI-side facts come through the AI-owned
 * `PROCESSING_SETTLEMENT_FACTS` port on the same transaction; nothing here queries the `ai` schema.
 */
@Injectable()
export class CreditReconciliationRepository extends BaseRepository<Document> {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(PROCESSING_SETTLEMENT_FACTS) private readonly settlementFacts: ProcessingSettlementFactsPort,
  ) {
    super(Document, dataSource);
  }

  /** Session-level advisory lock on a dedicated connection; `null` when another reconciler holds it. */
  async tryAcquireLock(): Promise<CreditReconciliationLock | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS "acquired"',
        [RECONCILER_LOCK_NAME],
      )) as Array<{ readonly acquired: boolean }>;
      if (rows[0]?.acquired !== true) {
        await runner.release();
        return null;
      }
    } catch (error) {
      await runner.release();
      throw error;
    }
    return {
      release: async (): Promise<void> => {
        try {
          await runner.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [RECONCILER_LOCK_NAME]);
        } finally {
          await runner.release();
        }
      },
    };
  }

  /** RESERVE rows older than the grace that have no `settle:` key, oldest first, after the keyset cursor. */
  async findOrphanReservationCandidates(input: {
    readonly after: OrphanReservationCursor | null;
    readonly graceMs: number;
    readonly limit: number;
  }): Promise<OrphanReservationCandidate[]> {
    const rows = await this.dataSource.query<CandidateRow[]>(
      `SELECT r."id", r."owner_id" AS "ownerId", r."job_id" AS "jobId", r."job_attempt" AS "processingAttempt",
              r."credits", r."created_at" AS "createdAt", r."created_at"::text AS "createdAtCursor",
              (SELECT n."created_at" FROM "course"."credit_ledger_entries" n
                WHERE n."business_key" = 'reserve:' || r."job_id" || ':' || (r."job_attempt" + 1)) AS "nextAttemptReservedAt"
         FROM "course"."credit_ledger_entries" r
        WHERE r."entry_type" = 'RESERVE'
          AND r."created_at" < now() - ($1::bigint * interval '1 millisecond')
          AND NOT EXISTS (SELECT 1 FROM "course"."credit_ledger_entries" s
                           WHERE s."business_key" = 'settle:' || r."job_id" || ':' || r."job_attempt")
          AND ($2::timestamptz IS NULL OR (r."created_at", r."id") > ($2::timestamptz, $3::uuid))
        ORDER BY r."created_at", r."id"
        LIMIT $4`,
      [input.graceMs, input.after?.createdAt ?? null, input.after?.id ?? null, input.limit],
    );
    return rows.map((row) => ({
      createdAt: row.createdAt,
      credits: Number(row.credits),
      cursor: { createdAt: row.createdAtCursor, id: String(row.id) },
      jobId: row.jobId,
      nextAttemptReservedAt: row.nextAttemptReservedAt ?? null,
      ownerId: row.ownerId,
      processingAttempt: Number(row.processingAttempt),
    }));
  }

  /** HOLD rows older than the wait that were never released, oldest first, after the keyset cursor. */
  async findExpiredHoldCandidates(input: {
    readonly after: OrphanReservationCursor | null;
    readonly limit: number;
    readonly releaseAfterMs: number;
  }): Promise<ExpiredHoldCandidate[]> {
    const rows = await this.dataSource.query<CandidateRow[]>(
      `SELECT h."id", h."owner_id" AS "ownerId", h."job_id" AS "jobId", h."job_attempt" AS "processingAttempt",
              h."credits", h."created_at" AS "createdAt", h."created_at"::text AS "createdAtCursor"
         FROM "course"."credit_ledger_entries" h
        WHERE h."entry_type" = 'HOLD' AND h."credits" > 0
          AND h."created_at" < now() - ($1::bigint * interval '1 millisecond')
          AND NOT EXISTS (SELECT 1 FROM "course"."credit_ledger_entries" x
                           WHERE x."business_key" = 'hold-release:' || h."job_id" || ':' || h."job_attempt")
          AND ($2::timestamptz IS NULL OR (h."created_at", h."id") > ($2::timestamptz, $3::uuid))
        ORDER BY h."created_at", h."id"
        LIMIT $4`,
      [input.releaseAfterMs, input.after?.createdAt ?? null, input.after?.id ?? null, input.limit],
    );
    return rows.map((row) => ({
      createdAt: row.createdAt,
      credits: Number(row.credits),
      cursor: { createdAt: row.createdAtCursor, id: String(row.id) },
      jobId: row.jobId,
      ownerId: row.ownerId,
      processingAttempt: Number(row.processingAttempt),
    }));
  }

  /**
   * One transaction per reservation, Document -> wallet lock order. `evaluate` decides from the AI facts; this
   * method only locks, applies the verdict through `settleReservation` and mirrors it on the Document row.
   * A dry run executes the same statements and rolls them back.
   */
  async reconcileReservation(input: {
    readonly candidate: OrphanReservationCandidate;
    readonly dryRun: boolean;
    readonly evaluate: (context: ReservationEvaluationContext) => Promise<ReservationVerdict>;
  }): Promise<ReservationReconcileResult> {
    try {
      return await this.dataSource.transaction((manager) => this.reconcileInTransaction(manager, input));
    } catch (error) {
      if (error instanceof DryRunRollback) return error.result;
      throw error;
    }
  }

  async releaseExpiredHold(candidate: ExpiredHoldCandidate): Promise<ExpiredHoldReleaseResult> {
    const outcome = await this.dataSource.transaction((manager) => releaseExpiredHold(manager, {
      jobId: candidate.jobId,
      ownerId: candidate.ownerId,
      processingAttempt: candidate.processingAttempt,
    }));
    if (outcome.kind === 'RELEASED') return outcome;
    return { kind: 'SKIPPED', reason: outcome.kind === 'SKIPPED_LOCKED' ? 'LOCKED' : outcome.kind };
  }

  private async reconcileInTransaction(
    manager: EntityManager,
    input: {
      readonly candidate: OrphanReservationCandidate;
      readonly dryRun: boolean;
      readonly evaluate: (context: ReservationEvaluationContext) => Promise<ReservationVerdict>;
    },
  ): Promise<ReservationReconcileResult> {
    const { candidate } = input;
    const lock = await lockDocumentOrWallet(manager, { jobId: candidate.jobId, ownerId: candidate.ownerId });
    if (lock.kind === 'LOCKED_BY_OTHER') return { kind: 'SKIPPED', reason: 'LOCKED' };
    if (await this.hasSettleKey(manager, candidate)) return { kind: 'SKIPPED', reason: 'SETTLED' };
    const document = lock.documentId === null ? null : await this.readDocument(manager, lock.documentId);
    const verdict = await input.evaluate({
      candidate,
      document,
      now: await this.readTransactionTime(manager),
      readFacts: (factsInput) => this.settlementFacts.readSettlementFacts(manager, factsInput),
    });
    if (verdict.kind === 'SKIP') return { kind: 'SKIPPED', reason: verdict.reason };
    const outcome = await settleReservation(manager, {
      hasUncertainDispatch: verdict.plan.hasUncertainDispatch,
      jobId: candidate.jobId,
      knownActualCredits: verdict.plan.knownActualCredits,
      ownerId: candidate.ownerId,
      processingAttempt: candidate.processingAttempt,
    });
    if (outcome.kind !== 'SETTLED') return { kind: 'SKIPPED', reason: 'SETTLED' };
    // Only the Document that still carries this attempt mirrors it; a newer attempt keeps its own budget status.
    if (document && document.processingAttempt === candidate.processingAttempt) {
      await manager.query(
        'UPDATE "course"."documents" SET "budget_status" = $2, "settled_credits" = $3 WHERE "id" = $1',
        [document.id, outcome.isHeld ? 'HELD' : 'SETTLED', outcome.settledCredits],
      );
    }
    const reservedCredits = candidate.credits;
    const remainder = Math.max(0, reservedCredits - verdict.plan.knownActualCredits);
    const result: ReservationReconcileResult = {
      kind: 'RESOLVED',
      resolution: {
        category: verdict.category,
        documentId: document?.id ?? null,
        evidence: verdict.evidence,
        heldCredits: outcome.isHeld ? remainder : 0,
        knownActualCredits: verdict.plan.knownActualCredits,
        releasedCredits: outcome.isHeld ? 0 : remainder,
        reservedCredits,
      },
    };
    if (input.dryRun) throw new DryRunRollback(result);
    return result;
  }

  private async hasSettleKey(manager: EntityManager, candidate: OrphanReservationCandidate): Promise<boolean> {
    const rows = await manager.query<readonly { readonly id: string }[]>(
      'SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
      [`settle:${candidate.jobId}:${candidate.processingAttempt}`],
    );
    return rows.length > 0;
  }

  private async readDocument(manager: EntityManager, documentId: string): Promise<ReconciledDocument> {
    const rows = await manager.query<readonly DocumentRow[]>(
      `SELECT "id", "status", "processing_attempt" AS "processingAttempt", "platform_model_id" AS "platformModelId",
              "updated_at" AS "updatedAt"
         FROM "course"."documents" WHERE "id" = $1`,
      [documentId],
    );
    const row = rows[0];
    if (!row) throw new Error('Locked Document disappeared inside the reconciler transaction');
    return {
      id: row.id,
      platformModelId: row.platformModelId,
      processingAttempt: Number(row.processingAttempt),
      status: row.status,
      updatedAt: row.updatedAt,
    };
  }

  private async readTransactionTime(manager: EntityManager): Promise<Date> {
    const rows = await manager.query<readonly { readonly now: Date }[]>('SELECT now() AS "now"');
    return rows[0]?.now ?? new Date();
  }
}
