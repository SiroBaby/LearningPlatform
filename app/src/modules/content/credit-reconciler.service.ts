import { Injectable } from '@nestjs/common';

import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../../config/application-config.service';
import type { CreditReconcilerSettings } from '../../config/configuration.types';
import {
  DocumentProcessingFailureCode,
  DocumentProcessingResultStatus,
} from '../ai/contracts/document-processing-result';
import type { DocumentProcessingUsage } from '../ai/contracts/document-processing-result';
import { parseDocumentProcessingUsageBlock } from '../ai/contracts/document-processing-usage.parser';
import type {
  ProcessingSettlementFacts,
  SettlementJobFacts,
} from '../ai/contracts/processing-settlement-facts.port';
import { JobStatus } from '../ai/enums/job-status.enum';
import type { DocumentSettlementPlan } from './contracts/document-status-projection.port';
import type {
  ExpiredHoldCandidate,
  OrphanReservationCandidate,
  OrphanReservationCursor,
  ReconciledDocument,
  ReservationEvaluationContext,
  ReservationEvidence,
  ReservationReconcileResult,
  ReservationResolution,
  ReservationResolutionCategory,
  ReservationVerdict,
} from './contracts/credit-reconciliation.contracts';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { planReservationSettlement } from './credit-estimation/settlement-planner';
import { DocumentStatus } from './enums/document-status.enum';
import { CreditReconciliationRepository } from './repositories/credit-reconciliation.repository';

export type CreditReconcileOutcome = 'COMPLETED' | 'SKIPPED_LOCK_HELD' | 'FAILED';

/** Counters of one run; also the payload of `credit.reconcile.completed`. */
export interface CreditReconcileReport {
  readonly outcome: CreditReconcileOutcome;
  readonly mode: 'apply' | 'dry-run';
  readonly scannedReservations: number;
  readonly settledCount: number;
  readonly releasedCount: number;
  readonly heldCount: number;
  readonly releasedCredits: number;
  readonly heldCredits: number;
  readonly skippedInFlight: number;
  readonly skippedLocked: number;
  readonly skippedLive: number;
  readonly heldScanned: number;
  readonly heldReleasedCount: number;
  readonly heldReleasedCredits: number;
}

type MutableCounters = { -readonly [Key in keyof CreditReconcileReport]: CreditReconcileReport[Key] };

/** Bounds one run: pages of `batchSize` candidates, so a long tail of skipped rows cannot starve later ones. */
const MAX_PAGES_PER_RUN = 20;
const MILLISECONDS_PER_SECOND = 1000;
const ACTIVE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set([JobStatus.PENDING, JobStatus.RUNNING]);

/**
 * Settles reservations that no return result will ever settle (#275): a Document deleted or an account revoked
 * mid-run fences the Go job, so it emits no result, and a reservation made before the job was forwarded has no job.
 * It always settles through `settleReservation` (so a late result is a no-op `ALREADY_SETTLED`) and prefers HOLD
 * over RELEASE whenever the spend is unknown. A HOLD that stays unresolved for the approved wait is released.
 */
@Injectable()
export class CreditReconcilerService {
  private readonly logger = createApplicationLogger({ context: CreditReconcilerService.name });

  constructor(
    private readonly repository: CreditReconciliationRepository,
    private readonly config: ApplicationConfigService,
    private readonly estimator: MediaCreditEstimator,
  ) {}

  /** Runs one bounded reconciliation. Never throws: failures are logged and reported as `FAILED`. */
  async reconcileOnce(signal?: AbortSignal): Promise<CreditReconcileReport> {
    const startedAt = Date.now();
    let mode: CreditReconcileReport['mode'] = 'dry-run';
    let counters = createCounters(mode);
    let lock: Awaited<ReturnType<CreditReconciliationRepository['tryAcquireLock']>> = null;
    try {
      // Read inside the try: invalid settings must be reported as FAILED, never thrown.
      const settings = this.config.creditReconciler;
      mode = settings.dryRun ? 'dry-run' : 'apply';
      counters = createCounters(mode);
      lock = await this.repository.tryAcquireLock();
      if (!lock) {
        this.logger.log({ event: 'credit.reconcile.skipped', reason: 'LOCK_HELD', runtime: 'worker' });
        return { ...counters, outcome: 'SKIPPED_LOCK_HELD' };
      }
      await this.reconcileReservations(settings, counters, signal);
      await this.releaseExpiredHolds(settings, counters, signal);
      this.logger.log({ ...counters, durationMs: Date.now() - startedAt, event: 'credit.reconcile.completed', runtime: 'worker' });
      return { ...counters };
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : 'UnknownError',
        event: 'credit.reconcile.failed',
        mode,
        runtime: 'worker',
        stage: 'run',
      });
      return { ...counters, outcome: 'FAILED' };
    } finally {
      await this.releaseLock(lock);
    }
  }

  private async reconcileReservations(
    settings: CreditReconcilerSettings,
    counters: MutableCounters,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let cursor: OrphanReservationCursor | null = null;
    for (let page = 0; page < MAX_PAGES_PER_RUN && !signal?.aborted; page += 1) {
      const candidates = await this.repository.findOrphanReservationCandidates({
        after: cursor,
        graceMs: settings.orphanGraceMs,
        limit: settings.batchSize,
      });
      for (const candidate of candidates) {
        if (signal?.aborted) return;
        counters.scannedReservations += 1;
        await this.reconcileCandidate(candidate, settings, counters);
      }
      const last = candidates[candidates.length - 1];
      if (!last || candidates.length < settings.batchSize) return;
      cursor = last.cursor;
    }
  }

  /** One failing reservation must not stop the others; it is logged and retried by the next run. */
  private async reconcileCandidate(
    candidate: OrphanReservationCandidate,
    settings: CreditReconcilerSettings,
    counters: MutableCounters,
  ): Promise<void> {
    try {
      const result = await this.repository.reconcileReservation({
        candidate,
        dryRun: settings.dryRun,
        evaluate: (context) => this.evaluateReservation(context, settings),
      });
      this.countReservationResult(result, counters);
      if (result.kind === 'RESOLVED') this.logResolution(candidate, result.resolution, settings.dryRun);
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : 'UnknownError',
        event: 'credit.reconcile.failed',
        jobId: candidate.jobId,
        mode: settings.dryRun ? 'dry-run' : 'apply',
        processingAttempt: candidate.processingAttempt,
        runtime: 'worker',
        stage: 'reservation',
      });
    }
  }

  private countReservationResult(result: ReservationReconcileResult, counters: MutableCounters): void {
    if (result.kind === 'RESOLVED') {
      counters.settledCount += 1;
      counters.releasedCredits += result.resolution.releasedCredits;
      counters.heldCredits += result.resolution.heldCredits;
      if (result.resolution.heldCredits > 0) counters.heldCount += 1;
      else counters.releasedCount += 1;
    } else if (result.reason === 'LOCKED') counters.skippedLocked += 1;
    else if (result.reason === 'LIVE') counters.skippedLive += 1;
    else counters.skippedInFlight += 1;
  }

  /**
   * Decides from the Document row and the AI facts. Evidence priority: the published result payload, then "no job"
   * and "never claimed" (nothing was dispatched), then the provider usage rows and speech-to-text checkpoints.
   */
  private async evaluateReservation(
    context: ReservationEvaluationContext,
    settings: CreditReconcilerSettings,
  ): Promise<ReservationVerdict> {
    const { candidate, document } = context;
    const facts = await context.readFacts({
      jobId: candidate.jobId,
      nextAttemptReservedAt: candidate.nextAttemptReservedAt,
      ownerId: candidate.ownerId,
      processingAttempt: candidate.processingAttempt,
      reservedAt: candidate.createdAt,
    });
    if (facts.hasUnpublishedResult) return { kind: 'SKIP', reason: 'IN_FLIGHT' };
    const category = classifyReservation(document, facts, candidate.processingAttempt);
    if (!category) return { kind: 'SKIP', reason: 'LIVE' };
    if (isJobLiveForAttempt(facts.job, category, candidate.processingAttempt)) return { kind: 'SKIP', reason: 'LIVE' };
    const referenceAt = resolveReferenceTime(context, facts, category);
    if (context.now.getTime() - referenceAt.getTime() < settings.orphanGraceMs) return { kind: 'SKIP', reason: 'LIVE' };
    const decision = this.decideSettlement(candidate, document, facts);
    return { category, evidence: decision.evidence, kind: 'SETTLE', plan: decision.plan };
  }

  private decideSettlement(
    candidate: OrphanReservationCandidate,
    document: ReconciledDocument | null,
    facts: ProcessingSettlementFacts,
  ): { readonly evidence: ReservationEvidence; readonly plan: DocumentSettlementPlan } {
    const platformModelId = document?.platformModelId ?? facts.job?.platformModelId ?? null;
    if (facts.latestPublishedResult) {
      // The payload carries only the Go queue attempt. With a newer Document attempt and no reserve boundary the
      // result may belong to that newer attempt, so the spend of this one is unknown.
      const isResultAttemptAmbiguous = (document?.processingAttempt ?? 0) > candidate.processingAttempt
        && candidate.nextAttemptReservedAt === null;
      return {
        evidence: 'RESULT_PAYLOAD',
        plan: isResultAttemptAmbiguous ? unknownSpendPlan() : this.planFromResult(facts.latestPublishedResult.payload, platformModelId),
      };
    }
    const { job } = facts;
    // No job and no Document (legacy budget/quiz path) leaves nothing to prove zero spend: hold, auto-release follows.
    if (!job) return { evidence: 'NO_JOB', plan: document ? noSpendPlan() : unknownSpendPlan() };
    if (job.processingAttempt === candidate.processingAttempt && job.attempts < candidate.processingAttempt) {
      return { evidence: 'NEVER_CLAIMED', plan: noSpendPlan() };
    }
    return { evidence: 'USAGE_RECORDS', plan: this.planFromUsageRecords(candidate, facts, job, platformModelId) };
  }

  private planFromResult(payload: Record<string, unknown>, platformModelId: string | null): DocumentSettlementPlan {
    const status = payload.status === DocumentProcessingResultStatus.FAILED ? DocumentStatus.FAILED : DocumentStatus.READY;
    const errorCode = typeof payload.errorCode === 'string' ? payload.errorCode as DocumentProcessingFailureCode : null;
    const usage = payload.usage === undefined || payload.usage === null ? null : parseDocumentProcessingUsageBlock(payload.usage);
    return this.plan({ errorCode, platformModelId, status, usage });
  }

  /**
   * Spend rebuilt from what survives cancellation. The remainder is HELD (never released) when any dispatch has an
   * unknown outcome, when the row predates attempt tracking, or when a dispatch could have been in flight without
   * leaving a record (a media job cancelled after it was claimed may have a speech-to-text request that Go never
   * checkpointed).
   */
  private planFromUsageRecords(
    candidate: OrphanReservationCandidate,
    facts: ProcessingSettlementFacts,
    job: SettlementJobFacts,
    platformModelId: string | null,
  ): DocumentSettlementPlan {
    const { llmRecords } = facts;
    const isAttemptKnown = job.processingAttempt === candidate.processingAttempt;
    // Speech-to-text rows hang off the CURRENT job row's probe result, which after a re-arm belongs to a newer
    // attempt: they only count when the row still describes this attempt.
    const stt = isAttemptKnown ? facts.stt : { billedMs: 0, uncertainMs: 0 };
    const usage: DocumentProcessingUsage = {
      llm: llmRecords.usage,
      sttBilledSeconds: stt.billedMs > 0 ? Math.ceil(stt.billedMs / MILLISECONDS_PER_SECOND) : null,
      sttUncertainSeconds: stt.uncertainMs > 0 ? Math.ceil(stt.uncertainMs / MILLISECONDS_PER_SECOND) : null,
      uncertainDispatches: llmRecords.unavailableCount,
    };
    const hasAnyEvidence = llmRecords.usage.length > 0 || llmRecords.unavailableCount > 0 || stt.billedMs > 0 || stt.uncertainMs > 0;
    const isClaimed = isAttemptKnown && job.attempts >= candidate.processingAttempt;
    const isSttPossiblyInFlight = job.probeResultId !== null
      && (!isAttemptKnown || (isClaimed && job.status === JobStatus.CANCELLED));
    // A claimed job with no record at all may still have dispatched (cancelled or finished without a result).
    const isSpendUnknown = job.processingAttempt === null
      || (!isAttemptKnown && !hasAnyEvidence)
      || (isClaimed && !hasAnyEvidence)
      || isSttPossiblyInFlight;
    const planned = this.plan({ errorCode: null, platformModelId, status: DocumentStatus.READY, usage });
    return { ...planned, hasUncertainDispatch: planned.hasUncertainDispatch || isSpendUnknown };
  }

  private plan(input: {
    readonly errorCode: DocumentProcessingFailureCode | null;
    readonly platformModelId: string | null;
    readonly status: DocumentStatus;
    readonly usage: DocumentProcessingUsage | null;
  }): DocumentSettlementPlan {
    return planReservationSettlement({
      ...input,
      estimator: this.estimator,
      platformModels: this.config.ai.platformModels,
    }).settlement;
  }

  /** Releases HOLDs that stayed unresolved for the approved wait. Dry run only counts them. */
  private async releaseExpiredHolds(
    settings: CreditReconcilerSettings,
    counters: MutableCounters,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let cursor: OrphanReservationCursor | null = null;
    for (let page = 0; page < MAX_PAGES_PER_RUN && !signal?.aborted; page += 1) {
      const candidates: ExpiredHoldCandidate[] = await this.repository.findExpiredHoldCandidates({
        after: cursor,
        limit: settings.batchSize,
        releaseAfterMs: settings.heldReleaseAfterMs,
      });
      for (const candidate of candidates) {
        if (signal?.aborted) return;
        counters.heldScanned += 1;
        await this.releaseCandidate(candidate, settings, counters);
      }
      const last = candidates[candidates.length - 1];
      if (!last || candidates.length < settings.batchSize) return;
      cursor = last.cursor;
    }
  }

  private async releaseCandidate(
    candidate: ExpiredHoldCandidate,
    settings: CreditReconcilerSettings,
    counters: MutableCounters,
  ): Promise<void> {
    if (settings.dryRun) {
      this.logger.log({
        credits: candidate.credits,
        dryRun: true,
        event: 'credit.hold.auto_release_dry_run',
        heldAgeSeconds: heldAgeSeconds(candidate),
        jobId: candidate.jobId,
        processingAttempt: candidate.processingAttempt,
        runtime: 'worker',
      });
      return;
    }
    try {
      const result = await this.repository.releaseExpiredHold(candidate);
      if (result.kind !== 'RELEASED') return;
      counters.heldReleasedCount += 1;
      counters.heldReleasedCredits += result.credits;
      this.logger.log({
        credits: result.credits,
        documentId: result.documentId,
        dryRun: false,
        event: 'credit.hold.auto_released',
        heldAgeSeconds: heldAgeSeconds(candidate),
        jobId: candidate.jobId,
        processingAttempt: candidate.processingAttempt,
        runtime: 'worker',
      });
    } catch (error) {
      this.logger.error({
        errorName: error instanceof Error ? error.name : 'UnknownError',
        event: 'credit.reconcile.failed',
        jobId: candidate.jobId,
        mode: 'apply',
        processingAttempt: candidate.processingAttempt,
        runtime: 'worker',
        stage: 'hold-release',
      });
    }
  }

  private logResolution(candidate: OrphanReservationCandidate, resolution: ReservationResolution, dryRun: boolean): void {
    this.logger.log({
      category: resolution.category,
      decision: resolution.heldCredits > 0 ? 'HOLD' : 'RELEASE',
      documentId: resolution.documentId,
      dryRun,
      event: 'credit.reconcile.reservation_resolved',
      evidence: resolution.evidence,
      heldCredits: resolution.heldCredits,
      jobId: candidate.jobId,
      knownActualCredits: resolution.knownActualCredits,
      processingAttempt: candidate.processingAttempt,
      reservedCredits: resolution.reservedCredits,
      runtime: 'worker',
    });
  }

  private async releaseLock(lock: Awaited<ReturnType<CreditReconciliationRepository['tryAcquireLock']>>): Promise<void> {
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      this.logger.error({ event: 'credit.reconcile.failed', runtime: 'worker', stage: 'lock-release' });
    }
  }
}

function createCounters(mode: CreditReconcileReport['mode']): MutableCounters {
  return {
    heldCount: 0,
    heldCredits: 0,
    heldReleasedCount: 0,
    heldReleasedCredits: 0,
    heldScanned: 0,
    mode,
    outcome: 'COMPLETED',
    releasedCount: 0,
    releasedCredits: 0,
    scannedReservations: 0,
    settledCount: 0,
    skippedInFlight: 0,
    skippedLive: 0,
    skippedLocked: 0,
  };
}

function unknownSpendPlan(): DocumentSettlementPlan {
  return { hasUncertainDispatch: true, knownActualCredits: 0 };
}

function noSpendPlan(): DocumentSettlementPlan {
  return { hasUncertainDispatch: false, knownActualCredits: 0 };
}

function heldAgeSeconds(candidate: ExpiredHoldCandidate): number {
  return Math.floor((Date.now() - candidate.createdAt.getTime()) / MILLISECONDS_PER_SECOND);
}

/** Which closed-world reason makes the reservation unreachable by the return seam; `null` means it may still progress. */
function classifyReservation(
  document: ReconciledDocument | null,
  facts: ProcessingSettlementFacts,
  processingAttempt: number,
): ReservationResolutionCategory | null {
  if (!document) return 'DOCUMENT_MISSING';
  if (document.status === DocumentStatus.DELETING) return 'DELETED';
  if (document.processingAttempt > processingAttempt) return 'SUPERSEDED';
  if (document.processingAttempt !== processingAttempt) return null;
  if (document.status === DocumentStatus.READY || document.status === DocumentStatus.FAILED) return 'TERMINAL_UNSETTLED';
  const isRevoked = facts.revoked && (facts.job?.cancellationMarkerId ?? null) !== null;
  return document.status === DocumentStatus.PROCESSING && isRevoked ? 'REVOKED' : null;
}

/** The queue row describes the newest attempt, so for a superseded attempt its status says nothing about this one. */
function isJobLiveForAttempt(
  job: SettlementJobFacts | null,
  category: ReservationResolutionCategory,
  processingAttempt: number,
): boolean {
  if (job === null || !ACTIVE_JOB_STATUSES.has(job.status)) return false;
  // Defensive: an active row that is not provably a newer attempt may still be running this one.
  return category !== 'SUPERSEDED' || job.processingAttempt === null || job.processingAttempt === processingAttempt;
}

function resolveReferenceTime(
  context: ReservationEvaluationContext,
  facts: ProcessingSettlementFacts,
  category: ReservationResolutionCategory,
): Date {
  if (category === 'SUPERSEDED') return context.candidate.nextAttemptReservedAt ?? context.candidate.createdAt;
  return facts.job?.cancelledAt ?? facts.job?.completedAt ?? context.document?.updatedAt ?? context.candidate.createdAt;
}
