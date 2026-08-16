import { Inject, Injectable, Optional } from '@nestjs/common';

import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../../config/application-config.service';

import { STORAGE_OBJECT_READER, StorageObjectReader } from '../../storage/contracts/storage-object-reader.port';
import {
  DOCUMENT_SOURCE_READER,
  DocumentSourceReader,
} from './contracts/extraction.contracts';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { JobProcessor } from './contracts/job-processor.port';
import { ProcessingJob } from './entities/processing-job.entity';
import { ExtractionService, MAX_EXTRACTABLE_OBJECT_BYTES } from './extraction.service';
import { ChunkService } from './chunk.service';
import { CHUNK_STORE, ChunkStore } from './contracts/chunk.contracts';
import { QUIZ_GENERATOR, type QuizGenerator } from './contracts/quiz-generator.port';

@Injectable()
export class ExtractionJobProcessor implements JobProcessor {
  private readonly logger = createApplicationLogger({ context: ExtractionJobProcessor.name });

  constructor(
    @Inject(DOCUMENT_SOURCE_READER) private readonly sources: DocumentSourceReader,
    @Inject(STORAGE_OBJECT_READER) private readonly objects: StorageObjectReader,
    private readonly extraction: ExtractionService,
    private readonly chunker: ChunkService,
    @Inject(CHUNK_STORE) private readonly chunks: ChunkStore,
    @Inject(QUIZ_GENERATOR) private readonly quizGeneration: QuizGenerator,
    @Optional() private readonly config?: ApplicationConfigService,
  ) {}

  async process(job: ProcessingJob): Promise<void> {
    if (!job.leaseId) {
      throw new ExtractionError(DocumentProcessingFailureCode.PROCESSING_FAILED);
    }
    const sourceStartedAt = performance.now();
    const source = await this.sources.read(job);
    this.logStage(job, 'source_read', sourceStartedAt);
    let bytes: Buffer;
    const objectStartedAt = performance.now();
    try {
      bytes = await this.objects.read(
        source.storageRef,
        this.config?.worker.maxExtractableObjectBytes ?? MAX_EXTRACTABLE_OBJECT_BYTES,
      );
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ExtractionError(DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE);
      }
      throw new ExtractionError(DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND);
    }
    this.logStage(job, 'object_read', objectStartedAt);
    const extractionStartedAt = performance.now();
    const extracted = await this.extraction.extract(source, bytes);
    this.logStage(job, 'extract', extractionStartedAt, { extractedSegmentCount: extracted.length });
    const chunkStartedAt = performance.now();
    const chunks = this.chunker.chunk(job.documentId, job.ownerId, extracted);
    this.logStage(job, 'chunk', chunkStartedAt, { chunkCount: chunks.length });
    const chunkPersistStartedAt = performance.now();
    const persisted = await this.chunks.replaceForDocument({
      attempt: job.attempts,
      chunks,
      documentId: job.documentId,
      jobId: job.id,
      leaseId: job.leaseId,
      ownerId: job.ownerId,
    });
    if (!persisted) {
      throw new ExtractionError(DocumentProcessingFailureCode.PROCESSING_FAILED);
    }
    this.logStage(job, 'chunk_persist', chunkPersistStartedAt, { chunkCount: chunks.length });
    const chunkReadStartedAt = performance.now();
    const persistedChunks = await this.chunks.findForDocument(job.documentId, job.ownerId);
    this.logStage(job, 'chunk_read', chunkReadStartedAt, { chunkCount: persistedChunks.length });
    const generationStartedAt = performance.now();
    await this.quizGeneration.generate({
      chunks: persistedChunks,
      job: {
        attempt: job.attempts,
        correlationId: job.correlationId,
        documentId: job.documentId,
        id: job.id,
        leaseId: job.leaseId,
        ownerId: job.ownerId,
        selection: job.modelSelectionKind === null
          ? null
          : {
              customModelConfigId: job.customModelConfigId,
              kind: job.modelSelectionKind,
              platformModelId: job.platformModelId,
            },
      },
    });
    this.logStage(job, 'generate', generationStartedAt, { chunkCount: persistedChunks.length });
  }

  private logStage(
    job: ProcessingJob,
    stage: string,
    startedAt: number,
    counts: Record<string, number | boolean> = {},
  ): void {
    this.logger.log({
      attempt: job.attempts,
      correlationId: job.correlationId,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      event: `ai.extraction.${stage}.completed`,
      jobId: job.id,
      ...counts,
    });
  }
}
