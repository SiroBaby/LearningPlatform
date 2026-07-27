import { Injectable } from '@nestjs/common';

import {
  DocumentSourceReader,
  ExtractionSource,
} from '../ai/contracts/extraction.contracts';
import { ExtractionError } from '../ai/contracts/extraction-error';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';

/** Content owns document metadata and exposes only the extraction source seam. */
@Injectable()
export class ContentDocumentSourceReader implements DocumentSourceReader {
  constructor(private readonly documents: ContentRepository) {}

  async read(job: ProcessingJob): Promise<ExtractionSource> {
    const document = await this.documents.findByOwnerId(job.ownerId, job.documentId);
    if (!document || (document.type !== DocumentType.PDF && document.type !== DocumentType.TEXT)) {
      throw new ExtractionError(DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND);
    }
    return { storageRef: document.storageRef, type: document.type };
  }
}
