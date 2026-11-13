import { randomUUID } from 'crypto';

import type { DataSource } from 'typeorm';

import { MediaCreditEstimator } from '../modules/content/credit-estimation/media-credit-estimator';
import { CreditReconcilerService } from '../modules/content/credit-reconciler.service';
import { Document } from '../modules/content/entities/document.entity';
import { DocumentStatus } from '../modules/content/enums/document-status.enum';
import { DocumentType } from '../modules/content/enums/document-type.enum';
import { CreditReconciliationRepository } from '../modules/content/repositories/credit-reconciliation.repository';
import { ProcessingJobRepository } from '../modules/ai/repositories/processing-job.repository';
import type { CreditReconcilerSettings } from '../config/configuration.types';
import type { TestDb } from './test-db';

export const RECONCILER_RESERVED_CREDITS = 1000;
export const RECONCILER_AVAILABLE_AFTER_RESERVE = 4000;
export const RECONCILER_PROCESSING_ATTEMPT = 2;
export const RECONCILER_PLATFORM_MODEL = {
  creditPerInputToken: 1,
  creditPerOutputToken: 2,
  id: 'platform-test',
  model: 'gpt-5.4-mini',
  planIds: ['free'],
};

/** Test settings: a 1 ms grace lets freshly seeded rows qualify; specs that need the grace pass a larger one. */
export const IMMEDIATE_RECONCILER_SETTINGS: CreditReconcilerSettings = {
  batchSize: 50,
  dryRun: false,
  enabled: true,
  heldReleaseAfterMs: 1,
  intervalMs: 300_000,
  orphanGraceMs: 1,
};

export interface ReconcilerRun {
  readonly document: Document;
  readonly jobId: string;
  readonly ownerId: string;
}

export interface SeedJobOptions {
  readonly attempts?: number;
  readonly cancelled?: boolean;
  readonly probeResultId?: string | null;
  readonly processingAttempt?: number | null;
  readonly status?: string;
}

export interface SeedRunOptions {
  readonly documentStatus?: DocumentStatus;
  readonly processingAttempt?: number;
  readonly type?: DocumentType;
  readonly withReservation?: boolean;
}

export function createReconcilerService(ds: DataSource, settings: CreditReconcilerSettings): CreditReconcilerService {
  return new CreditReconcilerService(
    new CreditReconciliationRepository(ds, new ProcessingJobRepository(ds)),
    { ai: { platformModels: [RECONCILER_PLATFORM_MODEL] }, creditReconciler: settings } as never,
    new MediaCreditEstimator(),
  );
}

/** Raw-SQL seeding and reading helpers shared by the credit reconciler specs. */
export class ReconcilerFixture {
  constructor(private readonly db: TestDb, private readonly ds: DataSource) {}

  async seedRun(options: SeedRunOptions = {}): Promise<ReconcilerRun> {
    const ownerId = randomUUID();
    const jobId = randomUUID();
    const attempt = options.processingAttempt ?? RECONCILER_PROCESSING_ATTEMPT;
    const withReservation = options.withReservation ?? true;
    const documents = this.ds.getRepository(Document);
    const document = await documents.save(documents.create({
      budgetStatus: withReservation ? 'RESERVED' : 'NOT_RESERVED',
      estimatedCredits: RECONCILER_RESERVED_CREDITS,
      fullPipelineJobId: jobId,
      modelSelectionKind: 'PLAN',
      originalName: 'lecture.txt',
      ownerId,
      platformModelId: RECONCILER_PLATFORM_MODEL.id,
      processingAttempt: attempt,
      sizeBytes: 100,
      status: options.documentStatus ?? DocumentStatus.PROCESSING,
      storageRef: `documents/${randomUUID()}.txt`,
      type: options.type ?? DocumentType.TEXT,
    }));
    await this.db.client.query(
      'INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits", "reserved_credits") VALUES ($1, $2, $3)',
      [ownerId, RECONCILER_AVAILABLE_AFTER_RESERVE, withReservation ? RECONCILER_RESERVED_CREDITS : 0],
    );
    if (withReservation) await this.seedReserve(ownerId, jobId, attempt);
    return { document, jobId, ownerId };
  }

  async seedReserve(ownerId: string, jobId: string, attempt: number, credits = RECONCILER_RESERVED_CREDITS): Promise<void> {
    await this.db.client.query(
      'INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, \'RESERVE\', $5)',
      [ownerId, jobId, attempt, `reserve:${jobId}:${attempt}`, credits],
    );
  }

  /** The FULL_PIPELINE queue row; its id is the Document's `full_pipeline_job_id`. */
  async seedJob(run: ReconcilerRun, options: SeedJobOptions = {}): Promise<void> {
    const attempt = options.processingAttempt === undefined ? run.document.processingAttempt : options.processingAttempt;
    await this.db.client.query(
      `INSERT INTO "ai"."processing_jobs"
         ("id", "document_id", "owner_id", "job_type", "status", "idempotency_key", "correlation_id", "attempts",
          "model_selection_kind", "platform_model_id", "probe_result_id", "processing_attempt",
          "cancellation_marker_id", "cancelled_at")
       VALUES ($1, $2, $3, 'FULL_PIPELINE', $4, $5, $6, $7, 'PLAN', $8, $9, $10, $11, $12)`,
      [
        run.jobId, run.document.id, run.ownerId, options.status ?? (options.cancelled ? 'CANCELLED' : 'RUNNING'),
        `full-pipeline:${run.jobId}`, randomUUID(), options.attempts ?? Number(run.document.processingAttempt),
        RECONCILER_PLATFORM_MODEL.id, options.probeResultId ?? null, attempt,
        options.cancelled ? randomUUID() : null, options.cancelled ? new Date() : null,
      ],
    );
  }

  async seedUsageRecord(run: ReconcilerRun, input: {
    readonly attempt?: number;
    readonly cached?: boolean;
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  }): Promise<void> {
    await this.db.client.query(
      `INSERT INTO "ai"."provider_usage_records"
         ("owner_id", "job_id", "job_attempt", "request_key", "provider_identity", "input_tokens", "output_tokens", "cached", "usage_status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        run.ownerId, run.jobId, input.attempt ?? run.document.processingAttempt,
        `go-llm:${run.jobId}:${input.attempt ?? run.document.processingAttempt}:1:${randomUUID()}`,
        RECONCILER_PLATFORM_MODEL.model, input.inputTokens ?? null, input.outputTokens ?? null,
        input.cached ?? false, input.status,
      ],
    );
  }

  /** A media probe result plus one STT checkpoint row; returns the probe result id for `seedJob`. */
  async seedSttCheckpoint(run: ReconcilerRun, input: { readonly billedMs: number; readonly uncertainMs: number }): Promise<string> {
    const probeJobId = randomUUID();
    const probeGeneration = randomUUID();
    await this.db.client.query(
      `INSERT INTO "ai"."media_probe_jobs"
         ("id", "document_id", "owner_id", "correlation_id", "probe_generation", "policy_version", "deletion_fence",
          "full_pipeline_job_id", "source_bucket", "source_key", "status", "idempotency_key")
       VALUES ($1, $2, $3, $4, $5, 'media-v1', 0, $6, 'bucket', 'key', 'COMPLETED', $7)`,
      [probeJobId, run.document.id, run.ownerId, randomUUID(), probeGeneration, run.jobId, randomUUID()],
    );
    const probeResultId = randomUUID();
    await this.db.client.query(
      `INSERT INTO "ai"."media_probe_results"
         ("id", "media_probe_job_id", "document_id", "owner_id", "probe_generation", "policy_version", "deletion_fence",
          "duration_sec", "bucket", "object_key", "version_id", "etag", "content_length", "full_pipeline_job_id")
       VALUES ($1, $2, $3, $4, $5, 'media-v1', 0, 60, 'bucket', 'key', 'v1', 'etag', 10, $6)`,
      [probeResultId, probeJobId, run.document.id, run.ownerId, probeGeneration, run.jobId],
    );
    await this.db.client.query(
      `INSERT INTO "ai"."media_stt_chunk_results"
         ("probe_result_id", "document_id", "owner_id", "chunk_index", "stt_provider_identity", "billed_ms", "uncertain_ms")
       VALUES ($1, $2, $3, 0, $4, $5, $6)`,
      [probeResultId, run.document.id, run.ownerId, 'a'.repeat(64), input.billedMs, input.uncertainMs],
    );
    return probeResultId;
  }

  async seedResult(run: ReconcilerRun, input: { readonly isPublished: boolean; readonly payload: Record<string, unknown> }): Promise<void> {
    await this.db.client.query(
      `INSERT INTO "ai"."outbox" ("aggregate_id", "event_type", "payload", "published_at")
       VALUES ($1, 'DocumentProcessingResult', $2, ${input.isPublished ? 'now()' : 'NULL'})`,
      [run.jobId, JSON.stringify({
        attempt: 1, documentId: run.document.id, errorCode: null, errorMessage: null, ownerId: run.ownerId,
        status: 'READY', version: 1, ...input.payload,
      })],
    );
  }

  /** Moves every timestamp of the run into the past so the grace and hold waits have elapsed. */
  async age(run: ReconcilerRun, minutes: number): Promise<void> {
    const shift = `${minutes} minutes`;
    await this.db.client.query('UPDATE "course"."credit_ledger_entries" SET "created_at" = "created_at" - $2::interval WHERE "job_id" = $1', [run.jobId, shift]);
    await this.db.client.query('UPDATE "course"."documents" SET "updated_at" = "updated_at" - $2::interval WHERE "id" = $1', [run.document.id, shift]);
    await this.db.client.query(
      'UPDATE "ai"."processing_jobs" SET "cancelled_at" = "cancelled_at" - $2::interval, "completed_at" = "completed_at" - $2::interval, "updated_at" = "updated_at" - $2::interval WHERE "id" = $1',
      [run.jobId, shift],
    );
    await this.db.client.query('UPDATE "ai"."outbox" SET "created_at" = "created_at" - $2::interval WHERE "aggregate_id" = $1', [run.jobId, shift]);
  }

  async readLedger(jobId: string): Promise<Record<string, string>> {
    const rows = (await this.db.client.query(
      'SELECT "business_key", "credits" FROM "course"."credit_ledger_entries" WHERE "job_id" = $1',
      [jobId],
    )).rows as { business_key: string; credits: string }[];
    return Object.fromEntries(rows.map((row) => [row.business_key, row.credits]));
  }

  async readWallet(ownerId: string): Promise<{ available_credits: string; reserved_credits: string }> {
    return (await this.db.client.query(
      'SELECT "available_credits", "reserved_credits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1',
      [ownerId],
    )).rows[0] as { available_credits: string; reserved_credits: string };
  }

  async readDocument(documentId: string): Promise<{ status: string; budget_status: string | null; settled_credits: string | null }> {
    return (await this.db.client.query(
      'SELECT "status", "budget_status", "settled_credits" FROM "course"."documents" WHERE "id" = $1',
      [documentId],
    )).rows[0] as { status: string; budget_status: string | null; settled_credits: string | null };
  }

  key(kind: string, run: ReconcilerRun, attempt = Number(run.document.processingAttempt)): string {
    return `${kind}:${run.jobId}:${attempt}`;
  }
}
