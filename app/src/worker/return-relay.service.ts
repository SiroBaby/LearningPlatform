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
        estimatedCredits: payload.estimatedCredits,
        estimateStatus: payload.estimateStatus,
        budgetStatus: payload.budgetStatus,
        errorMessage: payload.errorMessage,
        ownerId: payload.ownerId,
        settledCredits: payload.settledCredits,
        status:
          payload.status === DocumentProcessingResultStatus.READY
            ? DocumentStatus.READY
            : DocumentStatus.FAILED,
      });
      await this.outbox.markPublished(row.id);
    }
  }

  private parseResult(payload: Record<string, unknown>): DocumentProcessingResult {
    const errorCode = this.parseFailureCode(payload.errorCode);
    const budgetStatus = payload.budgetStatus ?? null;
    const estimatedCredits = payload.estimatedCredits ?? null;
    const estimateStatus = payload.estimateStatus ?? null;
    const settledCredits = payload.settledCredits ?? null;

    if (
      payload.version !== 1 ||
      typeof payload.documentId !== 'string' ||
      typeof payload.ownerId !== 'string' ||
      (budgetStatus !== null && typeof budgetStatus !== 'string') ||
      (estimatedCredits !== null && typeof estimatedCredits !== 'number') ||
      (estimateStatus !== null && typeof estimateStatus !== 'string') ||
      (settledCredits !== null && typeof settledCredits !== 'number') ||
      (payload.errorMessage !== null && typeof payload.errorMessage !== 'string') ||
      errorCode === undefined ||
      (payload.status !== DocumentProcessingResultStatus.READY &&
        payload.status !== DocumentProcessingResultStatus.FAILED)
    ) {
      throw new Error('Invalid document processing result outbox payload');
    }

    return {
      documentId: payload.documentId,
      budgetStatus,
      estimatedCredits,
      estimateStatus,
      errorCode,
      errorMessage: payload.errorMessage,
      ownerId: payload.ownerId,
      settledCredits,
      status: payload.status,
      version: payload.version,
    };
  }

  private parseFailureCode(
    value: unknown,
  ): DocumentProcessingFailureCode | null | undefined {
    if (value === null) return null;
    if (
      typeof value === 'string' &&
      Object.values(DocumentProcessingFailureCode).includes(
        value as DocumentProcessingFailureCode,
      )
    ) {
      return value as DocumentProcessingFailureCode;
    }
    return undefined;
  }
}
