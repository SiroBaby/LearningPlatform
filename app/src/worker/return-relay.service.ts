import { Inject, Injectable } from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import {
  DocumentProcessingFailureCode,
  DocumentProcessingResult,
  DocumentProcessingResultStatus,
} from '../modules/ai/contracts/document-processing-result';
import { AiOutboxRepository } from '../modules/ai/repositories/ai-outbox.repository';
import {
  QUIZ_GENERATION_HANDOFF,
  type QuizGenerationHandoffPort,
} from '../modules/assessment/contracts/quiz-generation-handoff.contract';
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
  private readonly logger = createApplicationLogger({ context: ReturnRelay.name });

  constructor(
    private readonly outbox: AiOutboxRepository,
    @Inject(DOCUMENT_STATUS_PROJECTION)
    private readonly projection: DocumentStatusProjection,
    @Inject(QUIZ_GENERATION_HANDOFF)
    private readonly quizHandoff: QuizGenerationHandoffPort,
  ) {}

  async pump(limit: number): Promise<void> {
    let pending: Awaited<ReturnType<AiOutboxRepository['findUnpublishedProcessingResults']>>;
    try {
      pending = await this.outbox.findUnpublishedProcessingResults(limit);
    } catch (error) {
      this.logger.error({
        event: 'ai.job.return.failed',
        jobId: null,
        runtime: 'worker',
        stage: 'outbox-read',
      });
      throw error;
    }

    for (const row of pending) {
      let stage: ReturnRelayFailureStage = 'parse';

      try {
        const startedAt = performance.now();
        const queueWaitMs = Math.max(0, Date.now() - row.createdAt.getTime());
        const payload = this.parseResult(row.payload);
        if (payload.status === DocumentProcessingResultStatus.READY && payload.questions) {
          stage = 'quiz-persist';
          await this.quizHandoff.persist({
            documentId: payload.documentId,
            minimumQuestionCount: 1,
            ownerId: payload.ownerId,
            promptVersion: 'phase0-v1',
            questions: payload.questions,
          });
        }
        const projectionStartedAt = performance.now();
        stage = 'document-project';
        await this.projection.project({
          documentId: payload.documentId,
          estimatedCredits: payload.estimatedCredits,
          estimateStatus: payload.estimateStatus,
          budgetStatus: payload.budgetStatus,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          ownerId: payload.ownerId,
          settledCredits: payload.settledCredits,
          status:
            payload.status === DocumentProcessingResultStatus.READY
              ? DocumentStatus.READY
              : DocumentStatus.FAILED,
        });
        const projectionDurationMs = elapsedMilliseconds(projectionStartedAt);
        const publishStartedAt = performance.now();
        stage = 'outbox-publish';
        await this.outbox.markPublished(row.id);
        this.logger.log({
          documentId: payload.documentId,
          durationMs: elapsedMilliseconds(startedAt),
          event: 'ai.job.return.projected',
          jobId: row.aggregateId,
          publishDurationMs: elapsedMilliseconds(publishStartedAt),
          queueWaitMs,
          projectionDurationMs,
          runtime: 'worker',
        });
      } catch (error) {
        this.logger.error({
          event: 'ai.job.return.failed',
          jobId: row.aggregateId,
          runtime: 'worker',
          stage,
        });
        throw error;
      }
    }
  }

  private parseResult(payload: Record<string, unknown>): DocumentProcessingResult {
    const errorCode = this.parseFailureCode(payload.errorCode);
    const budgetStatus = payload.budgetStatus ?? null;
    const estimatedCredits = payload.estimatedCredits ?? null;
    const estimateStatus = payload.estimateStatus ?? null;
    const settledCredits = payload.settledCredits ?? null;
    const questions = this.parseQuestions(payload.questions);

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
      questions === undefined ||
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
      questions,
      settledCredits,
      status: payload.status,
      version: payload.version,
    };
  }

  private parseQuestions(
    value: unknown,
  ): DocumentProcessingResult['questions'] | undefined {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value)) return undefined;
    const questions = value as DocumentProcessingResult['questions'];
    if (!questions) return null;
    if (!questions.every((question) =>
      typeof question.chunkId === 'string' &&
      Number.isInteger(question.chunkIndex) &&
      Number.isInteger(question.ordinal) &&
      typeof question.stem === 'string' &&
      typeof question.explanation === 'string' &&
      typeof question.citation?.chunkId === 'string' &&
      typeof question.citation?.snippet === 'string' &&
      typeof question.citation?.locator === 'object' && question.citation.locator !== null &&
      Array.isArray(question.options) &&
      question.options.every((option) => typeof option.content === 'string' && typeof option.isCorrect === 'boolean')
    )) return undefined;
    return questions;
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

type ReturnRelayFailureStage =
  | 'outbox-read'
  | 'parse'
  | 'quiz-persist'
  | 'document-project'
  | 'outbox-publish';

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
