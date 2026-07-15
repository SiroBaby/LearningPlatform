import { Inject, Injectable, Optional } from '@nestjs/common';

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
    const source = await this.sources.read(job);
    let bytes: Buffer;
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
    const extracted = await this.extraction.extract(source, bytes);
    const chunks = this.chunker.chunk(job.documentId, job.ownerId, extracted);
    const persisted = await this.chunks.replaceForDocument({
      attempt: job.attempts,
      chunks,
      documentId: job.documentId,
      jobId: job.id,
      ownerId: job.ownerId,
    });
    if (!persisted) {
      throw new ExtractionError(DocumentProcessingFailureCode.PROCESSING_FAILED);
    }
    const persistedChunks = await this.chunks.findForDocument(job.documentId, job.ownerId);
    await this.quizGeneration.generate({
      chunks: persistedChunks,
      job: { documentId: job.documentId, ownerId: job.ownerId },
    });
  }
}
