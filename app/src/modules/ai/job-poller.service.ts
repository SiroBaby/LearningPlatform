import { Inject, Injectable } from '@nestjs/common';

import {
  DocumentProcessingFailureCode,
} from './contracts/document-processing-result';
import { JOB_PROCESSOR, type JobProcessor } from './contracts/job-processor.port';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

/**
 * Poller của ai: nhặt một job PENDING -> RUNNING -> chạy pipeline -> COMPLETED.
 *
 * Phase 0 issue 01: pipeline là no-op placeholder (chỉ chứng minh backbone chảy).
 * Các stage thật (extract/chunk/generate) thay vào ở issue 03-05.
 *
 * Dùng FOR UPDATE SKIP LOCKED để nhiều poller/replica không nhặt trùng job
 * (an toàn concurrency, map sang consumer group Kafka ở Phase 2).
 */
@Injectable()
export class JobPoller {
  constructor(
    private readonly processingJobs: ProcessingJobRepository,
    @Inject(JOB_PROCESSOR) private readonly processor: JobProcessor,
  ) {}

  async tick(): Promise<boolean> {
    const claimed = await this.processingJobs.claimPending();

    if (!claimed) return false;

    const job = await this.processingJobs.findOneByOrFail({ id: claimed });
    try {
      await this.processor.process(job);
      await this.processingJobs.complete(claimed);
    } catch {
      await this.processingJobs.fail(
        claimed,
        DocumentProcessingFailureCode.PROCESSING_FAILED,
      );
    }
    return true;
  }
}
