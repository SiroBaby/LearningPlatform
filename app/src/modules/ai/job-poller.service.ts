import { Inject, Injectable } from '@nestjs/common';

import {
  DocumentProcessingFailureCode,
} from './contracts/document-processing-result';
import { ExtractionError } from './contracts/extraction-error';
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
    const job = await this.processingJobs.claimPending();
    if (!job) return false;
    const attempt = { attempts: job.attempts, id: job.id };
    try {
      await this.processor.process(job);
      await this.processingJobs.complete(attempt);
    } catch (error) {
      await this.processingJobs.fail(
        attempt,
        error instanceof ExtractionError
          ? error.code
          : DocumentProcessingFailureCode.PROCESSING_FAILED,
      );
    }
    return true;
  }
}
