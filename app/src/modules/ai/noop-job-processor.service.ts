import { Injectable } from '@nestjs/common';

import type { JobProcessor } from './contracts/job-processor.port';
import { ProcessingJob } from './entities/processing-job.entity';

// Phase 0 seam: extraction and generation are deliberately not implemented yet.
@Injectable()
export class NoopJobProcessor implements JobProcessor {
  async process(_job: ProcessingJob): Promise<void> {}
}
