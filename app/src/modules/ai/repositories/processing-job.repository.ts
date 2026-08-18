import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { EnqueueCommand } from '../contracts/ai-ingestion.port';
import {
  DOCUMENT_PROCESSING_RESULT_EVENT,
  DOCUMENT_PROCESSING_RESULT_VERSION,
  DocumentProcessingFailureCode,
  DocumentProcessingResultStatus,
} from '../contracts/document-processing-result';
import { AiOutboxEvent } from '../entities/ai-outbox-event.entity';
import { ProcessingJob } from '../entities/processing-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import type { ProcessingJobModelSelection } from '../contracts/processing-job-model-selection.port';
import type { ProcessingJobBudget } from '../contracts/processing-job-budget.port';

export interface ProcessingJobAttempt {
  readonly attempts: number;
  readonly id: string;
  readonly leaseId: string;
}

const TECHNICAL_RETRY_DELAYS = ['5 seconds', '30 seconds', '5 minutes'] as const;

@Injectable()
export class ProcessingJobRepository extends BaseRepository<ProcessingJob> implements ProcessingJobBudget, ProcessingJobModelSelection {
  constructor(private readonly dataSource: DataSource) {
    super(ProcessingJob, dataSource);
  }

  async enqueue(command: EnqueueCommand, idempotencyKey: string): Promise<void> {
    await this.query(
      `
      INSERT INTO "ai"."processing_jobs"
        ("document_id", "owner_id", "job_type", "status",
         "idempotency_key", "correlation_id", "attempts", "model_selection_kind", "platform_model_id", "custom_model_config_id")
      VALUES ($1, $2, $3, 'PENDING', $4, $5, 0, $6, $7, $8)
      ON CONFLICT ("document_id", "job_type") DO UPDATE
        SET "status"     = 'PENDING',
            "attempts"   = "processing_jobs"."attempts" + 1,
            "technical_retry_count" = 0,
            "updated_at" = now()
        WHERE "processing_jobs"."status" = 'FAILED'
      `,
      [
        command.documentId,
        command.ownerId,
        command.jobType,
        idempotencyKey,
        command.correlationId,
        command.selection?.kind ?? null,
        command.selection?.platformModelId ?? null,
        command.selection?.customModelConfigId ?? null,
      ],
    );
  }

  async claimPending(): Promise<ProcessingJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
        SELECT "id" FROM "ai"."processing_jobs"
        WHERE ("status" = 'PENDING' AND "next_visible_at" <= now())
           OR ("status" = 'RUNNING' AND "lease_until" <= now())
        ORDER BY "created_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        `,
      );

      if (rows.length === 0) {
        return null;
      }

      const id: string = rows[0].id;
      const claimed: Array<ProcessingJobAttempt> = await manager.query(
        `
        UPDATE "ai"."processing_jobs"
        SET "attempts" = "attempts" + 1,
            "lease_id" = gen_random_uuid(),
            "lease_until" = now() + interval '15 minutes',
            "status" = 'RUNNING', "updated_at" = now()
        WHERE "id" = $1
          AND (
            ("status" = 'PENDING' AND "next_visible_at" <= now())
            OR ("status" = 'RUNNING' AND "lease_until" <= now())
          )
        RETURNING "id", "attempts", "lease_id" AS "leaseId"
        `,
        [id],
      );
      const attempt = claimed[0];
      if (!attempt) return null;
      const job = await manager.findOneByOrFail(ProcessingJob, {
        attempts: attempt.attempts,
        id: attempt.id,
        leaseId: attempt.leaseId,
        status: JobStatus.RUNNING,
      });
      return job;
    });
  }

  async complete(attempt: ProcessingJobAttempt): Promise<boolean> {
    return this.finalize(
      attempt,
      JobStatus.COMPLETED,
      DocumentProcessingResultStatus.READY,
      null,
    );
  }

  async ensureDefaultPlatformModel(input: {
    readonly attempt: number;
    readonly jobId: string;
    readonly leaseId: string;
    readonly modelId: string;
    readonly ownerId: string;
  }): Promise<boolean> {
    const [rows]: [Array<{ readonly id: string }>, number] = await this.query(
      `
      UPDATE "ai"."processing_jobs"
      SET "model_selection_kind" = 'PLAN', "platform_model_id" = $5, "updated_at" = now()
      WHERE "id" = $1 AND "attempts" = $2 AND "owner_id" = $3 AND "lease_id" = $4 AND "status" = 'RUNNING'
        AND "lease_until" > now()
        AND "model_selection_kind" IS NULL AND "platform_model_id" IS NULL AND "custom_model_config_id" IS NULL
      RETURNING "id"
      `,
      [input.jobId, input.attempt, input.ownerId, input.leaseId, input.modelId],
    );
    return rows.length === 1;
  }

  async record(input: {
    readonly attempt: number;
    readonly budgetStatus: string;
    readonly estimatedCredits: number;
    readonly jobId: string;
    readonly leaseId: string;
    readonly settledCredits: number;
  }): Promise<boolean> {
    const [rows]: [Array<{ readonly id: string }>, number] = await this.query(
      `UPDATE "ai"."processing_jobs"
       SET "estimated_credits" = $4, "settled_credits" = $5, "budget_status" = $6, "updated_at" = now()
       WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3 AND "status" = 'RUNNING'
         AND "lease_until" > now()
       RETURNING "id"`,
      [input.jobId, input.attempt, input.leaseId, input.estimatedCredits, input.settledCredits, input.budgetStatus],
    );
    return rows.length === 1;
  }

  async fail(
    attempt: ProcessingJobAttempt,
    errorCode: DocumentProcessingFailureCode,
  ): Promise<boolean> {
    return this.finalize(
      attempt,
      JobStatus.FAILED,
      DocumentProcessingResultStatus.FAILED,
      errorCode,
    );
  }

  async retryTechnical(
    attempt: ProcessingJobAttempt,
    reasonCode: DocumentProcessingFailureCode,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ readonly technical_retry_count: number }> = await manager.query(
        `SELECT "technical_retry_count" FROM "ai"."processing_jobs"
         WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3 AND "status" = 'RUNNING'
           AND "lease_until" > now()
         FOR UPDATE`,
        [attempt.id, attempt.attempts, attempt.leaseId],
      );
      const job = rows[0];
      if (!job) return false;
      if (job.technical_retry_count >= TECHNICAL_RETRY_DELAYS.length) {
        const [finalized]: [Array<{ readonly id: string }>, number] = await manager.query(
          `UPDATE "ai"."processing_jobs"
           SET "status" = 'FAILED', "failure_code" = $4, "error_message" = $5,
               "lease_id" = NULL, "lease_until" = NULL, "completed_at" = now(), "updated_at" = now()
           WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3 AND "status" = 'RUNNING'
             AND "lease_until" > now()
           RETURNING "id"`,
          [attempt.id, attempt.attempts, attempt.leaseId, reasonCode, this.failureMessage(reasonCode)],
        );
        if (finalized.length !== 1) return false;
        await manager.query(
          `INSERT INTO "ai"."processing_job_dlq" ("job_id", "document_id", "owner_id", "correlation_id", "idempotency_key", "last_attempt", "reason_code")
           SELECT "id", "document_id", "owner_id", "correlation_id", "idempotency_key", "attempts", $2
           FROM "ai"."processing_jobs" WHERE "id" = $1
           ON CONFLICT ("job_id") DO NOTHING`,
          [attempt.id, reasonCode],
        );
        const processingJob = await manager.findOneByOrFail(ProcessingJob, { id: attempt.id });
        await manager.save(AiOutboxEvent, this.createResultEvent(
          processingJob,
          DocumentProcessingResultStatus.FAILED,
          reasonCode,
        ));
        return true;
      }
      const [requeued]: [Array<{ readonly id: string }>, number] = await manager.query(
        `UPDATE "ai"."processing_jobs"
         SET "status" = 'PENDING', "technical_retry_count" = "technical_retry_count" + 1,
             "failure_code" = $4, "lease_id" = NULL, "lease_until" = NULL,
             "next_visible_at" = now() + $5::interval, "updated_at" = now()
         WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3 AND "status" = 'RUNNING'
           AND "lease_until" > now()
         RETURNING "id"`,
        [attempt.id, attempt.attempts, attempt.leaseId, reasonCode, TECHNICAL_RETRY_DELAYS[job.technical_retry_count]],
      );
      return requeued.length === 1;
    });
  }

  async requeueExpiredLeases(limit: number): Promise<number> {
    const [released]: [Array<{ readonly id: string }>, number] = await this.dataSource.transaction(
      (manager) => manager.query(
        `
        WITH "expired" AS (
          SELECT "id" FROM "ai"."processing_jobs"
          WHERE "status" = 'RUNNING' AND "lease_until" <= now()
          ORDER BY "updated_at" ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "ai"."processing_jobs" AS "job"
        SET "status" = 'PENDING', "lease_id" = NULL, "lease_until" = NULL,
            "next_visible_at" = now(), "updated_at" = now()
        FROM "expired"
        WHERE "job"."id" = "expired"."id"
          AND "job"."status" = 'RUNNING' AND "job"."lease_until" <= now()
        RETURNING "job"."id"
        `,
        [limit],
      ),
    );
    return released.length;
  }

  private async finalize(
    attempt: ProcessingJobAttempt,
    jobStatus: JobStatus.COMPLETED | JobStatus.FAILED,
    documentStatus: DocumentProcessingResultStatus,
    errorCode: DocumentProcessingFailureCode | null,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(ProcessingJob, {
        where: { attempts: attempt.attempts, id: attempt.id, leaseId: attempt.leaseId, status: JobStatus.RUNNING },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        return false;
      }

      const [finalized]: [Array<{ readonly id: string }>, number] = await manager.query(
        `
        UPDATE "ai"."processing_jobs"
        SET "status" = $2, "failure_code" = $3, "error_message" = $4,
            "lease_id" = NULL, "lease_until" = NULL, "completed_at" = now(), "updated_at" = now()
        WHERE "id" = $1 AND "attempts" = $5 AND "lease_id" = $6 AND "status" = 'RUNNING'
          AND "lease_until" > now()
        RETURNING "id"
        `,
        [attempt.id, jobStatus, errorCode, this.failureMessage(errorCode), attempt.attempts, attempt.leaseId],
      );
      if (finalized.length !== 1) {
        return false;
      }
      await manager.save(AiOutboxEvent, this.createResultEvent(job, documentStatus, errorCode));
      return true;
    });
  }

  private createResultEvent(
    job: ProcessingJob,
    documentStatus: DocumentProcessingResultStatus,
    errorCode: DocumentProcessingFailureCode | null,
  ): AiOutboxEvent {
    return this.dataSource.manager.create(AiOutboxEvent, {
      aggregateId: job.id,
      eventType: DOCUMENT_PROCESSING_RESULT_EVENT,
      payload: {
        documentId: job.documentId,
        budgetStatus: job.budgetStatus ?? (errorCode === DocumentProcessingFailureCode.BUDGET_EXHAUSTED ? 'EXHAUSTED' : null),
        estimatedCredits: job.estimatedCredits === null ? null : Number(job.estimatedCredits),
        estimateStatus: job.estimatedCredits === null ? null : 'AUTHORITATIVE',
        errorCode,
        errorMessage: this.failureMessage(errorCode),
        ownerId: job.ownerId,
        settledCredits: job.settledCredits === null ? null : Number(job.settledCredits),
        status: documentStatus,
        version: DOCUMENT_PROCESSING_RESULT_VERSION,
      },
    });
  }

  private failureMessage(errorCode: DocumentProcessingFailureCode | null): string | null {
    if (errorCode === DocumentProcessingFailureCode.PROCESSING_TIMED_OUT) {
      return 'Processing timed out';
    }
    if (errorCode === DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE) {
      return 'Document processing is temporarily unavailable. Please try again later.';
    }
    if (errorCode === DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED) {
      return 'Document exceeds configured chunk processing limits';
    }
    if (errorCode === DocumentProcessingFailureCode.BUDGET_EXHAUSTED) {
      return 'Processing budget was exhausted';
    }
    if (errorCode === DocumentProcessingFailureCode.PROCESSING_FAILED) {
      return 'Processing failed';
    }
    if (errorCode === DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND) {
      return 'Uploaded object could not be read';
    }
    if (errorCode === DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE) {
      return 'Uploaded object exceeds the extraction size limit';
    }
    if (errorCode === DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID) {
      return 'Generated question output is invalid';
    }
    if (errorCode === DocumentProcessingFailureCode.GENERATION_OUTPUT_TRUNCATED) {
      return 'Generated question output was truncated. Please try again later.';
    }
    if (errorCode === DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS) {
      return 'Not enough valid questions were generated';
    }
    if (errorCode === DocumentProcessingFailureCode.PDF_INVALID) {
      return 'Uploaded PDF could not be parsed';
    }
    if (errorCode === DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND) {
      return 'Uploaded PDF has no extractable text layer';
    }
    return null;
  }
}
