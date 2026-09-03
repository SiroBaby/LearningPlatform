import { Injectable } from '@nestjs/common';

import {
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from './contracts/document-status-projection.port';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
  constructor(private readonly contentRepository: ContentRepository) {}

  async project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome> {
    return this.contentRepository.projectProcessingResult(command);
  }
}
