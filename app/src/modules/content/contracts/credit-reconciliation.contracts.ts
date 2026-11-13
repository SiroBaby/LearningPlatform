import type {
  ProcessingSettlementFacts,
  ReadSettlementFactsInput,
} from '../../ai/contracts/processing-settlement-facts.port';
import type { DocumentStatus } from '../enums/document-status.enum';
import type { DocumentSettlementPlan } from './document-status-projection.port';

/** An open RESERVE row with no `settle:` key yet. */
export interface OrphanReservationCandidate {
  readonly createdAt: Date;
  readonly credits: number;
  /** Keyset cursor (exact database timestamp text + ledger id): `Date` would drop PostgreSQL's microseconds. */
  readonly cursor: OrphanReservationCursor;
  readonly jobId: string;
  readonly ownerId: string;
  readonly processingAttempt: number;
  /** Reserve time of `processingAttempt + 1`, when the Document was retried; bounds the attempt's results. */
  readonly nextAttemptReservedAt: Date | null;
}

export interface OrphanReservationCursor {
  readonly createdAt: string;
  readonly id: string;
}

/** An unresolved HOLD older than the owner-approved wait. */
export interface ExpiredHoldCandidate {
  readonly createdAt: Date;
  readonly credits: number;
  readonly cursor: OrphanReservationCursor;
  readonly jobId: string;
  readonly ownerId: string;
  readonly processingAttempt: number;
}

/** The Document row locked by the reconciler transaction (the ledger key, not the Go queue attempt). */
export interface ReconciledDocument {
  readonly id: string;
  readonly platformModelId: string | null;
  readonly processingAttempt: number;
  readonly status: DocumentStatus;
  readonly updatedAt: Date;
}

export interface ReservationEvaluationContext {
  readonly candidate: OrphanReservationCandidate;
  /** `null` when the Document row no longer exists. */
  readonly document: ReconciledDocument | null;
  /** Database transaction time: grace checks compare database timestamps with it, never with the app clock. */
  readonly now: Date;
  readonly readFacts: (input: ReadSettlementFactsInput) => Promise<ProcessingSettlementFacts>;
}

export type ReservationResolutionCategory =
  | 'DELETED'
  | 'DOCUMENT_MISSING'
  | 'REVOKED'
  | 'SUPERSEDED'
  | 'TERMINAL_UNSETTLED';

export type ReservationEvidence =
  | 'NEVER_CLAIMED'
  | 'NO_JOB'
  | 'RESULT_PAYLOAD'
  | 'USAGE_RECORDS';

export type ReservationVerdict =
  | { readonly kind: 'SKIP'; readonly reason: 'IN_FLIGHT' | 'LIVE' }
  | {
    readonly category: ReservationResolutionCategory;
    readonly evidence: ReservationEvidence;
    readonly kind: 'SETTLE';
    readonly plan: DocumentSettlementPlan;
  };

export interface ReservationResolution {
  readonly category: ReservationResolutionCategory;
  readonly documentId: string | null;
  readonly evidence: ReservationEvidence;
  readonly heldCredits: number;
  readonly knownActualCredits: number;
  readonly releasedCredits: number;
  readonly reservedCredits: number;
}

export type ReservationReconcileResult =
  | { readonly kind: 'RESOLVED'; readonly resolution: ReservationResolution }
  | { readonly kind: 'SKIPPED'; readonly reason: 'IN_FLIGHT' | 'LIVE' | 'LOCKED' | 'SETTLED' };

export type ExpiredHoldReleaseResult =
  | { readonly kind: 'RELEASED'; readonly credits: number; readonly documentId: string | null }
  | { readonly kind: 'SKIPPED'; readonly reason: 'ALREADY_RELEASED' | 'LOCKED' | 'NO_HOLD' };

export interface CreditReconciliationLock {
  readonly release: () => Promise<void>;
}
