import { Injectable } from '@nestjs/common';

import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Injectable()
export class StuckJobDetector {
  constructor(private readonly processingJobs: ProcessingJobRepository) {}

  async requeueExpiredLeases(limit: number): Promise<number> {
    return this.processingJobs.requeueExpiredLeases(limit);
  }
}
