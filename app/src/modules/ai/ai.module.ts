import { Module } from '@nestjs/common';

import { AiIngestionService } from './ai-ingestion.service';
import { AI_INGESTION } from './contracts/ai-ingestion.port';
import { JOB_PROCESSOR } from './contracts/job-processor.port';
import { JobPoller } from './job-poller.service';
import { NoopJobProcessor } from './noop-job-processor.service';
import { AiOutboxRepository } from './repositories/ai-outbox.repository';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { StuckJobDetector } from './stuck-job-detector.service';

@Module({
  providers: [
    AiIngestionService,
    AiOutboxRepository,
    ProcessingJobRepository,
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    NoopJobProcessor,
    { provide: JOB_PROCESSOR, useExisting: NoopJobProcessor },
    JobPoller,
    StuckJobDetector,
  ],
  exports: [AI_INGESTION, AiOutboxRepository, JobPoller, StuckJobDetector],
})
export class AiModule {}
