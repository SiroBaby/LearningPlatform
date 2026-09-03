import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

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
  AssessmentError,
  AssessmentErrorCode,
} from '../modules/assessment/domain/assessment.error';
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
      let payload: DocumentProcessingResult | undefined;

      try {
        const startedAt = performance.now();
        const queueWaitMs = Math.max(0, Date.now() - row.createdAt.getTime());
        payload = this.parseResult(row.payload);
        const projectionStartedAt = performance.now();
        stage = 'document-project';
        const projectionOutcome = await this.projection.project({
          attempt: payload.attempt,
          documentId: payload.documentId,
          estimatedCredits: payload.estimatedCredits,
          estimateStatus: payload.estimateStatus,
          budgetStatus: payload.budgetStatus,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          eventCreatedAt: row.createdAt,
          leaseId: payload.leaseId,
          ownerId: payload.ownerId,
          settledCredits: payload.settledCredits,
          status:
            payload.status === DocumentProcessingResultStatus.READY
              ? DocumentStatus.READY
              : DocumentStatus.FAILED,
        });
        if (projectionOutcome === 'UNVERIFIED_LEGACY') {
          this.logger.error({
            event: 'ai.job.return.unverified_legacy',
            jobId: row.aggregateId,
            runtime: 'worker',
            stage: 'document-project',
          });
          throw new LegacyUnfencedResultError();
        }
        const projectionDurationMs = elapsedMilliseconds(projectionStartedAt);
        if (
          (projectionOutcome === 'APPLIED' || projectionOutcome === 'ALREADY_APPLIED') &&
          payload.status === DocumentProcessingResultStatus.READY &&
          payload.questions
        ) {
          stage = 'quiz-persist';
          await this.quizHandoff.persist({
            documentId: payload.documentId,
            minimumQuestionCount: 1,
            ownerId: payload.ownerId,
            promptVersion: 'phase0-v1',
            questions: payload.questions,
          });
        }
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
        if (
          stage === 'quiz-persist' &&
          payload !== undefined &&
          error instanceof AssessmentError &&
          error.code === AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS
        ) {
          // Invalid generated questions are terminal for this result. Persist the
          // failure and acknowledge the outbox row so a deterministic payload
          // cannot block every later return event forever.
          try {
            const projectionOutcome = await this.projection.project({
              attempt: payload.attempt,
              documentId: payload.documentId,
              estimatedCredits: payload.estimatedCredits,
              estimateStatus: payload.estimateStatus,
              budgetStatus: payload.budgetStatus,
              errorCode: DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS,
              errorMessage: 'Not enough valid questions were generated',
              eventCreatedAt: row.createdAt,
              leaseId: payload.leaseId,
              ownerId: payload.ownerId,
              settledCredits: payload.settledCredits,
              status: DocumentStatus.FAILED,
            });
            if (projectionOutcome === 'UNVERIFIED_LEGACY') {
              this.logger.error({
                event: 'ai.job.return.unverified_legacy',
                jobId: row.aggregateId,
                runtime: 'worker',
                stage: 'document-project',
              });
              throw new LegacyUnfencedResultError();
            }
            await this.outbox.markPublished(row.id);
            this.logger.error({
              event: 'ai.job.return.terminal_failed',
              errorCode: DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS,
              jobId: row.aggregateId,
              runtime: 'worker',
              stage,
            });
            continue;
          } catch (terminalizationError) {
            this.logger.error({
              event: 'ai.job.return.failed',
              jobId: row.aggregateId,
              runtime: 'worker',
              stage,
            });
            throw terminalizationError;
          }
        }
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
    // Pre-fence v1 rows may omit both fields; partial or malformed fences fail closed.
    const attempt = payload.attempt === undefined
      ? null
      : typeof payload.attempt === 'number'
        ? payload.attempt
        : null;
    const hasInvalidAttempt = payload.attempt !== undefined && typeof payload.attempt !== 'number';
    const errorCode = this.parseFailureCode(payload.errorCode);
    const budgetStatus = payload.budgetStatus ?? null;
    const estimatedCredits = payload.estimatedCredits ?? null;
    const estimateStatus = payload.estimateStatus ?? null;
    const settledCredits = payload.settledCredits ?? null;
    const leaseId = payload.leaseId === undefined
      ? null
      : typeof payload.leaseId === 'string'
        ? payload.leaseId
        : null;
    const hasInvalidLeaseId = payload.leaseId !== undefined &&
      (typeof payload.leaseId !== 'string' || !isUuid(payload.leaseId));
    const questions = this.parseQuestions(payload.questions);

    if (
      payload.version !== 1 ||
      hasInvalidAttempt ||
      (attempt !== null && (!Number.isInteger(attempt) || attempt < 1)) ||
      typeof payload.documentId !== 'string' ||
      typeof payload.ownerId !== 'string' ||
      (budgetStatus !== null && typeof budgetStatus !== 'string') ||
      (estimatedCredits !== null && typeof estimatedCredits !== 'number') ||
      (estimateStatus !== null && typeof estimateStatus !== 'string') ||
      (settledCredits !== null && typeof settledCredits !== 'number') ||
      (payload.errorMessage !== null && typeof payload.errorMessage !== 'string') ||
      hasInvalidLeaseId ||
      ((attempt === null) !== (leaseId === null)) ||
      errorCode === undefined ||
      questions === undefined ||
      (payload.status !== DocumentProcessingResultStatus.READY &&
        payload.status !== DocumentProcessingResultStatus.FAILED)
    ) {
      throw new Error('Invalid document processing result outbox payload');
    }

    return {
      attempt,
      documentId: payload.documentId,
      budgetStatus,
      estimatedCredits,
      estimateStatus,
      errorCode,
      errorMessage: payload.errorMessage,
      leaseId,
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

export class LegacyUnfencedResultError extends Error {
  constructor() {
    super('Legacy document processing result cannot be associated with the current processing run');
    this.name = LegacyUnfencedResultError.name;
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
