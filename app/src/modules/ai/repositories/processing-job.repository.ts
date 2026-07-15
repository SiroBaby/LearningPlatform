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

export interface ProcessingJobAttempt {
  readonly attempts: number;
  readonly id: string;
}

@Injectable()
export class ProcessingJobRepository extends BaseRepository<ProcessingJob> {
  constructor(private readonly dataSource: DataSource) {
    super(ProcessingJob, dataSource);
  }

  async enqueue(command: EnqueueCommand, idempotencyKey: string): Promise<void> {
    await this.query(
      `
      INSERT INTO "ai"."processing_jobs"
        ("document_id", "owner_id", "job_type", "status",
         "idempotency_key", "correlation_id", "attempts")
      VALUES ($1, $2, $3, 'PENDING', $4, $5, 0)
      ON CONFLICT ("document_id", "job_type") DO UPDATE
        SET "status"     = 'PENDING',
            "attempts"   = "processing_jobs"."attempts" + 1,
            "updated_at" = now()
        WHERE "processing_jobs"."status" = 'FAILED'
      `,
      [
        command.documentId,
        command.ownerId,
        command.jobType,
        idempotencyKey,
        command.correlationId,
      ],
    );
  }

  async claimPending(): Promise<ProcessingJob | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
        SELECT "id" FROM "ai"."processing_jobs"
        WHERE "status" = 'PENDING'
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
        SET "attempts" = "attempts" + 1, "status" = 'RUNNING', "updated_at" = now()
        WHERE "id" = $1 AND "status" = 'PENDING'
        RETURNING "id", "attempts"
        `,
        [id],
      );
      const attempt = claimed[0];
      if (!attempt) return null;
      return manager.findOneByOrFail(ProcessingJob, {
        attempts: attempt.attempts,
        id: attempt.id,
        status: JobStatus.RUNNING,
      });
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

  async findStuckRunning(timeoutMs: number, limit: number): Promise<ProcessingJobAttempt[]> {
    const rows = await this.query(
      `
      SELECT "id", "attempts" FROM "ai"."processing_jobs"
      WHERE "status" = 'RUNNING'
        AND "updated_at" < now() - ($1 * interval '1 millisecond')
      ORDER BY "updated_at" ASC
      LIMIT $2
      `,
      [timeoutMs, limit],
    );
    return rows.map((row: ProcessingJobAttempt) => ({ attempts: row.attempts, id: row.id }));
  }

  private async finalize(
    attempt: ProcessingJobAttempt,
    jobStatus: JobStatus.COMPLETED | JobStatus.FAILED,
    documentStatus: DocumentProcessingResultStatus,
    errorCode: DocumentProcessingFailureCode | null,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(ProcessingJob, {
        where: { attempts: attempt.attempts, id: attempt.id, status: JobStatus.RUNNING },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        return false;
      }

      await manager.query(
        `
        UPDATE "ai"."processing_jobs"
        SET "status" = $2, "error_message" = $3, "updated_at" = now()
        WHERE "id" = $1 AND "attempts" = $4 AND "status" = 'RUNNING'
        `,
        [attempt.id, jobStatus, this.failureMessage(errorCode), attempt.attempts],
      );
      const event = manager.create(AiOutboxEvent, {
        aggregateId: job.id,
        eventType: DOCUMENT_PROCESSING_RESULT_EVENT,
        payload: {
          documentId: job.documentId,
          errorCode,
          errorMessage: this.failureMessage(errorCode),
          ownerId: job.ownerId,
          status: documentStatus,
          version: DOCUMENT_PROCESSING_RESULT_VERSION,
        },
      });
      await manager.save(AiOutboxEvent, event);
      return true;
    });
  }

  private failureMessage(errorCode: DocumentProcessingFailureCode | null): string | null {
    if (errorCode === DocumentProcessingFailureCode.PROCESSING_TIMED_OUT) {
      return 'Processing timed out';
    }
    if (errorCode === DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED) {
      return 'Document exceeds configured chunk processing limits';
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
