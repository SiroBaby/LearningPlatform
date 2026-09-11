import { Injectable } from '@nestjs/common';

import {
  DocumentProbeCompletionCommand,
  DocumentProbeCompletionOutcome,
  DocumentProbeFailureCommand,
  DocumentProbeFailureOutcome,
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from './contracts/document-status-projection.port';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
  constructor(private readonly contentRepository: ContentRepository) {}

  async completeProbe(command: DocumentProbeCompletionCommand): Promise<DocumentProbeCompletionOutcome> {
    return this.contentRepository.completeProbe(command);
  }

  async failProbe(command: DocumentProbeFailureCommand): Promise<DocumentProbeFailureOutcome> {
    return this.contentRepository.failProbe(command);
  }

  async project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome> {
    return this.contentRepository.projectProcessingResult(command);
  }
}
