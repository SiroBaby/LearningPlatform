import { Injectable } from '@nestjs/common';

import {
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
} from './contracts/document-status-projection.port';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
  constructor(private readonly contentRepository: ContentRepository) {}

  async project(command: DocumentStatusProjectionCommand): Promise<void> {
    await this.contentRepository.projectProcessingResult(command);
  }
}
