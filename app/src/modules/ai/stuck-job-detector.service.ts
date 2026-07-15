import { Injectable } from '@nestjs/common';

import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Injectable()
export class StuckJobDetector {
  constructor(private readonly processingJobs: ProcessingJobRepository) {}

  async detectAndFail(timeoutMs: number, limit: number): Promise<number> {
    const stuckJobs = await this.processingJobs.findStuckRunning(timeoutMs, limit);
    let failed = 0;

    for (const attempt of stuckJobs) {
      if (await this.processingJobs.fail(
        attempt,
        DocumentProcessingFailureCode.PROCESSING_TIMED_OUT,
      )) {
        failed += 1;
      }
    }

    return failed;
  }
}
