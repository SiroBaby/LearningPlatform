import { forwardRef, Module } from '@nestjs/common';

import { ContentModule } from '../content/content.module';
import { AssessmentModule } from '../assessment/assessment.module';

import { AiIngestionService } from './ai-ingestion.service';
import { AI_INGESTION } from './contracts/ai-ingestion.port';
import { JOB_PROCESSOR } from './contracts/job-processor.port';
import { JobPoller } from './job-poller.service';
import { ExtractionJobProcessor } from './extraction-job-processor.service';
import { ExtractionService, loadPdfJsModule, PDF_JS_MODULE } from './extraction.service';
import { AiOutboxRepository } from './repositories/ai-outbox.repository';
import { ProcessingJobRepository } from './repositories/processing-job.repository';
import { StuckJobDetector } from './stuck-job-detector.service';
import { ChunkService } from './chunk.service';
import { CHUNK_STORE } from './contracts/chunk.contracts';
import { ChunkRepository } from './repositories/chunk.repository';
import { GENERATION_CACHE } from './contracts/generation-cache.contracts';
import { PROMPT_VERSION_STORE } from './contracts/prompt-version.contracts';
import { QUIZ_GENERATOR } from './contracts/quiz-generator.port';
import { QuizGenerationService } from './quiz-generation.service';
import { GenerationCacheRepository } from './repositories/generation-cache.repository';
import { PromptVersionRepository } from './repositories/prompt-version.repository';

@Module({
  imports: [AssessmentModule, forwardRef(() => ContentModule)],
  providers: [
    AiIngestionService,
    AiOutboxRepository,
    ChunkRepository,
    GenerationCacheRepository,
    PromptVersionRepository,
    ProcessingJobRepository,
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    { provide: PDF_JS_MODULE, useFactory: loadPdfJsModule },
    ExtractionService,
    ChunkService,
    QuizGenerationService,
    ExtractionJobProcessor,
    { provide: JOB_PROCESSOR, useExisting: ExtractionJobProcessor },
    { provide: CHUNK_STORE, useExisting: ChunkRepository },
    { provide: GENERATION_CACHE, useExisting: GenerationCacheRepository },
    { provide: PROMPT_VERSION_STORE, useExisting: PromptVersionRepository },
    { provide: QUIZ_GENERATOR, useExisting: QuizGenerationService },
    JobPoller,
    StuckJobDetector,
  ],
  exports: [AI_INGESTION, AiOutboxRepository, JobPoller, StuckJobDetector],
})
export class AiModule {}
