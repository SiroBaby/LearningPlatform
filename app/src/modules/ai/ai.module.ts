import { forwardRef, Module } from '@nestjs/common';

import { ContentModule } from '../content/content.module';

import { AiIngestionService } from './ai-ingestion.service';
import { AI_INGESTION } from './contracts/ai-ingestion.port';
import { JOB_PROCESSOR } from './contracts/job-processor.port';
import { JobPoller } from './job-poller.service';
import { ExtractionJobProcessor } from './extraction-job-processor.service';
import { ExtractionService, loadPdfJsModule, PDF_JS_MODULE } from './extraction.service';
import { EXTRACTED_SEGMENT_SINK } from './contracts/extraction.contracts';
import { InMemoryExtractedSegmentStore } from './in-memory-extracted-segment-store.service';
import { AiOutboxRepository } from './repositories/ai-outbox.repository';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { StuckJobDetector } from './stuck-job-detector.service';

@Module({
  imports: [forwardRef(() => ContentModule)],
  providers: [
    AiIngestionService,
    AiOutboxRepository,
    ProcessingJobRepository,
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    { provide: PDF_JS_MODULE, useFactory: loadPdfJsModule },
    ExtractionService,
    ExtractionJobProcessor,
    InMemoryExtractedSegmentStore,
    { provide: JOB_PROCESSOR, useExisting: ExtractionJobProcessor },
    { provide: EXTRACTED_SEGMENT_SINK, useExisting: InMemoryExtractedSegmentStore },
    JobPoller,
    StuckJobDetector,
  ],
  exports: [AI_INGESTION, AiOutboxRepository, JobPoller, StuckJobDetector],
})
export class AiModule {}
