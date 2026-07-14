import { Injectable } from '@nestjs/common';

import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Injectable()
export class StuckJobDetector {
  constructor(private readonly processingJobs: ProcessingJobRepository) {}

  async detectAndFail(timeoutMs: number, limit: number): Promise<number> {
    const stuckJobIds = await this.processingJobs.findStuckRunning(timeoutMs, limit);

    for (const id of stuckJobIds) {
      await this.processingJobs.fail(
        id,
        DocumentProcessingFailureCode.PROCESSING_TIMED_OUT,
      );
    }

    return stuckJobIds.length;
  }
}
