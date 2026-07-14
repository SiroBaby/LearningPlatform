import { Inject, Injectable } from '@nestjs/common';

import {
  DocumentProcessingFailureCode,
  DocumentProcessingResult,
  DocumentProcessingResultStatus,
} from '../modules/ai/contracts/document-processing-result';
import { AiOutboxRepository } from '../modules/ai/repositories/ai-outbox.repository';
import {
  DOCUMENT_STATUS_PROJECTION,
  DocumentStatusProjection,
} from '../modules/content/contracts/document-status-projection.port';
import { DocumentStatus } from '../modules/content/enums/document-status.enum';

/**
 * Transport for the return seam. Delivery is at-least-once: projection first,
 * then ai.outbox is marked published in a separate transaction.
 */
@Injectable()
export class ReturnRelay {
  constructor(
    private readonly outbox: AiOutboxRepository,
    @Inject(DOCUMENT_STATUS_PROJECTION)
    private readonly projection: DocumentStatusProjection,
  ) {}

  async pump(limit: number): Promise<void> {
    const pending = await this.outbox.findUnpublishedProcessingResults(limit);

    for (const row of pending) {
      const payload = this.parseResult(row.payload);
      await this.projection.project({
        documentId: payload.documentId,
        errorMessage: payload.errorMessage,
        ownerId: payload.ownerId,
        status:
          payload.status === DocumentProcessingResultStatus.READY
            ? DocumentStatus.READY
            : DocumentStatus.FAILED,
      });
      await this.outbox.markPublished(row.id);
    }
  }

  private parseResult(payload: Record<string, unknown>): DocumentProcessingResult {
    if (
      payload.version !== 1 ||
      typeof payload.documentId !== 'string' ||
      typeof payload.ownerId !== 'string' ||
      (payload.errorMessage !== null && typeof payload.errorMessage !== 'string') ||
      (payload.errorCode !== null &&
        payload.errorCode !== 'PROCESSING_FAILED' &&
        payload.errorCode !== 'PROCESSING_TIMED_OUT') ||
      (payload.status !== DocumentProcessingResultStatus.READY &&
        payload.status !== DocumentProcessingResultStatus.FAILED)
    ) {
      throw new Error('Invalid document processing result outbox payload');
    }

    return {
      documentId: payload.documentId,
      errorCode:
        payload.errorCode === 'PROCESSING_TIMED_OUT'
          ? DocumentProcessingFailureCode.PROCESSING_TIMED_OUT
          : payload.errorCode === 'PROCESSING_FAILED'
            ? DocumentProcessingFailureCode.PROCESSING_FAILED
            : null,
      errorMessage: payload.errorMessage,
      ownerId: payload.ownerId,
      status: payload.status,
      version: payload.version,
    };
  }
}
