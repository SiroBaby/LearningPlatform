import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { AiIngestion, EnqueueCommand } from './contracts/ai-ingestion.port';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Injectable()
export class AiIngestionService implements AiIngestion {
  constructor(
    private readonly processingJobs: ProcessingJobRepository,
  ) {}

  /**
   * Upsert idempotent trong MỘT câu lệnh nguyên tử (an toàn concurrency):
   * - chưa có -> INSERT status=PENDING
   * - ON CONFLICT (document_id, job_type):
   *     + đang FAILED -> re-arm về PENDING + attempts+1 (ADR-0012)
   *     + else (PENDING/RUNNING/COMPLETED) -> WHERE không khớp -> no-op
   */
  async enqueue(cmd: EnqueueCommand): Promise<void> {
    const idempotencyKey = this.buildKey(cmd.documentId, cmd.jobType);

    await this.processingJobs.enqueue(cmd, idempotencyKey);
  }

  // hash(document_id + job_type) — document-scoped (ADR-0005)
  private buildKey(documentId: string, jobType: string): string {
    return createHash('sha256')
      .update(`${documentId}:${jobType}`)
      .digest('hex')
      .slice(0, 64);
  }
}
