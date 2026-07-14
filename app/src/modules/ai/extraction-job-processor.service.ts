import { Inject, Injectable, Optional } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';

import { STORAGE_OBJECT_READER, StorageObjectReader } from '../../storage/contracts/storage-object-reader.port';
import {
  DOCUMENT_SOURCE_READER,
  DocumentSourceReader,
  EXTRACTED_SEGMENT_SINK,
  ExtractedSegmentSink,
} from './contracts/extraction.contracts';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { JobProcessor } from './contracts/job-processor.port';
import { ProcessingJob } from './entities/processing-job.entity';
import { ExtractionService, MAX_EXTRACTABLE_OBJECT_BYTES } from './extraction.service';

@Injectable()
export class ExtractionJobProcessor implements JobProcessor {
  constructor(
    @Inject(DOCUMENT_SOURCE_READER) private readonly sources: DocumentSourceReader,
    @Inject(STORAGE_OBJECT_READER) private readonly objects: StorageObjectReader,
    private readonly extraction: ExtractionService,
    @Inject(EXTRACTED_SEGMENT_SINK) private readonly segments: ExtractedSegmentSink,
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
    await this.segments.save(job, extracted);
  }
}
