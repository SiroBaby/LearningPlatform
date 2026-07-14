import { Injectable } from '@nestjs/common';

import { ProcessingJob } from './entities/processing-job.entity';
import { ExtractedSegment, ExtractedSegmentSink } from './contracts/extraction.contracts';

/** Temporary Issue 03 seam; Issue 04 replaces this with durable chunks. */
@Injectable()
export class InMemoryExtractedSegmentStore implements ExtractedSegmentSink {
  private readonly segmentsByJobId = new Map<string, readonly ExtractedSegment[]>();

  async save(job: ProcessingJob, segments: readonly ExtractedSegment[]): Promise<void> {
    this.segmentsByJobId.set(job.id, segments);
  }

  get(jobId: string): readonly ExtractedSegment[] | undefined {
    return this.segmentsByJobId.get(jobId);
  }
}
