import { Module } from '@nestjs/common';

import { AiIngestionService } from './ai-ingestion.service';
import { AI_INGESTION } from './contracts/ai-ingestion.port';
import { JobPoller } from './job-poller.service';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Module({
  providers: [
    AiIngestionService,
    ProcessingJobRepository,
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    JobPoller,
  ],
  exports: [AI_INGESTION, JobPoller],
})
export class AiModule {}
