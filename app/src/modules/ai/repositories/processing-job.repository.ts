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

  async claimPending(): Promise<string | null> {
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
      await manager.update(ProcessingJob, { id }, { status: JobStatus.RUNNING });
      return id;
    });
  }

  async complete(id: string): Promise<void> {
    await this.finalize(
      id,
      JobStatus.COMPLETED,
      DocumentProcessingResultStatus.READY,
      null,
    );
  }

  async fail(id: string, errorCode: DocumentProcessingFailureCode): Promise<void> {
    await this.finalize(
      id,
      JobStatus.FAILED,
      DocumentProcessingResultStatus.FAILED,
      errorCode,
    );
  }

  async findStuckRunning(timeoutMs: number, limit: number): Promise<string[]> {
    const rows = await this.query(
      `
      SELECT "id" FROM "ai"."processing_jobs"
      WHERE "status" = 'RUNNING'
        AND "updated_at" < now() - ($1 * interval '1 millisecond')
      ORDER BY "updated_at" ASC
      LIMIT $2
      `,
      [timeoutMs, limit],
    );
    return rows.map((row: { id: string }) => row.id);
  }

  private async finalize(
    id: string,
    jobStatus: JobStatus.COMPLETED | JobStatus.FAILED,
    documentStatus: DocumentProcessingResultStatus,
    errorCode: DocumentProcessingFailureCode | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const job = await manager.findOne(ProcessingJob, {
        where: { id, status: JobStatus.RUNNING },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job) {
        return;
      }

      await manager.query(
        `
        UPDATE "ai"."processing_jobs"
        SET "status" = $2, "error_message" = $3, "updated_at" = now()
        WHERE "id" = $1 AND "status" = 'RUNNING'
        `,
        [id, jobStatus, this.failureMessage(errorCode)],
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
    });
  }

  private failureMessage(errorCode: DocumentProcessingFailureCode | null): string | null {
    if (errorCode === DocumentProcessingFailureCode.PROCESSING_TIMED_OUT) {
      return 'Processing timed out';
    }
    if (errorCode === DocumentProcessingFailureCode.PROCESSING_FAILED) {
      return 'Processing failed';
    }
    return null;
  }
}
