import { Injectable } from '@nestjs/common';

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
  constructor(private readonly processingJobs: ProcessingJobRepository) {}

  async tick(): Promise<void> {
    const claimed = await this.processingJobs.claimPending();

    if (!claimed) return;

    // --- no-op pipeline placeholder (issue 03-05 sẽ thay bằng stage thật) ---

    await this.processingJobs.complete(claimed);
  }
}
