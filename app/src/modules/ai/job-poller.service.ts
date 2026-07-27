import { Inject, Injectable } from '@nestjs/common';

import { createApplicationLogger } from '../../common/logging/application-logger.factory';
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
  private readonly logger = createApplicationLogger({ context: JobPoller.name });

  constructor(
    private readonly processingJobs: ProcessingJobRepository,
    @Inject(JOB_PROCESSOR) private readonly processor: JobProcessor,
  ) {}

  async tick(): Promise<boolean> {
    const job = await this.processingJobs.claimPending();
    if (!job) return false;
    const attempt = { attempts: job.attempts, id: job.id };
    const jobLog = {
      attempt: job.attempts,
      correlationId: job.correlationId,
      jobId: job.id,
      jobType: job.jobType,
      runtime: 'worker',
    };
    this.logger.log({ event: 'ai.job.claimed', ...jobLog });
    try {
      await this.processor.process(job);
      if (await this.processingJobs.complete(attempt)) {
        this.logger.log({ event: 'ai.job.completed', ...jobLog });
      }
    } catch (error) {
      const errorCode = error instanceof ExtractionError
        ? error.code
        : DocumentProcessingFailureCode.PROCESSING_FAILED;
      if (await this.processingJobs.fail(
        attempt,
        errorCode,
      )) {
        this.logger.warn({ errorCode, event: 'ai.job.failed', ...jobLog });
      }
    }
    return true;
  }
}
