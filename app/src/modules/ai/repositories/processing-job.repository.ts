import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { EnqueueCommand } from '../contracts/ai-ingestion.port';
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
    await this.update({ id }, { status: JobStatus.COMPLETED });
  }
}
