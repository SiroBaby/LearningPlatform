import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import {
  DocumentProcessingFailureCode,
  DocumentProcessingResult,
  DocumentProcessingResultStatus,
} from '../modules/ai/contracts/document-processing-result';
import { MEDIA_PROBE_JOB_TYPE } from '../modules/ai/contracts/ai-ingestion.port';
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
} from '../modules/content/contracts/document-status-projection.port';
import type {
  DocumentProbeFailureCommand,
  DocumentStatusProjection,
} from '../modules/content/contracts/document-status-projection.port';
import { DocumentStatus } from '../modules/content/enums/document-status.enum';
import { normalizeStorageVersionId } from '../storage/storage-version-id';

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

        if (row.eventType === 'DocumentProbeCompleted') {
          stage = 'probe-project';
          const probe = this.parseProbeCompletion(row.payload);
          const projectionStartedAt = performance.now();
          const projectionOutcome = await this.projection.completeProbe({
            deletionFence: probe.deletionFence,
            documentId: probe.documentId,
            durationSec: probe.durationSec,
            eventCreatedAt: row.createdAt,
            fullPipelineJobId: probe.fullPipelineJobId,
            ownerId: probe.ownerId,
            policyVersion: probe.policyVersion,
            probeResultId: probe.probeResultId,
            probeGeneration: probe.probeGeneration,
            locator: {
              bucket: probe.locator.bucket,
              contentLength: probe.locator.contentLength,
              etag: probe.locator.etag,
              key: probe.locator.key,
              versionId: probe.locator.versionId,
            },
          });
          const projectionDurationMs = elapsedMilliseconds(projectionStartedAt);
          const publishStartedAt = performance.now();
          stage = 'outbox-publish';
          await this.outbox.markPublished(row.id);
          this.logger.log({
            documentId: probe.documentId,
            durationMs: elapsedMilliseconds(startedAt),
            event: 'ai.job.return.probe_projected',
            jobId: row.aggregateId,
            outcome: projectionOutcome,
            publishDurationMs: elapsedMilliseconds(publishStartedAt),
            projectionDurationMs,
            queueWaitMs,
            runtime: 'worker',
          });
          continue;
        }

        if (
          row.eventType === 'DocumentProbeFailed' ||
          (row.eventType === 'DocumentProcessingResult' &&
            row.payload.jobType === MEDIA_PROBE_JOB_TYPE)
        ) {
          stage = 'probe-failure-project';
          const probeFailure = this.parseProbeFailure(row.payload);
          const projectionStartedAt = performance.now();
          const projectionOutcome = await this.projection.failProbe({
            attempt: probeFailure.attempt,
            deletionFence: probeFailure.deletionFence,
            documentId: probeFailure.documentId,
            errorCode: probeFailure.errorCode,
            errorMessage: probeFailure.errorMessage,
            eventCreatedAt: row.createdAt,
            leaseId: probeFailure.leaseId,
            ownerId: probeFailure.ownerId,
            policyVersion: probeFailure.policyVersion,
            probeGeneration: probeFailure.probeGeneration,
          });
          const projectionDurationMs = elapsedMilliseconds(projectionStartedAt);
          const publishStartedAt = performance.now();
          stage = 'outbox-publish';
          await this.outbox.markPublished(row.id);
          this.logger.log({
            documentId: probeFailure.documentId,
            durationMs: elapsedMilliseconds(startedAt),
            event: 'ai.job.return.probe_failed',
            jobId: row.aggregateId,
            outcome: projectionOutcome,
            publishDurationMs: elapsedMilliseconds(publishStartedAt),
            projectionDurationMs,
            queueWaitMs,
            runtime: 'worker',
          });
          continue;
        }

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

  private parseProbeCompletion(payload: Record<string, unknown>): ProbeCompletionPayload {
    const locator = this.parseProbeLocator(payload.locator);
    if (
      payload.version !== 1 ||
      typeof payload.documentId !== 'string' ||
      !isUuid(payload.documentId) ||
      typeof payload.ownerId !== 'string' ||
      !isUuid(payload.ownerId) ||
      typeof payload.probeGeneration !== 'string' ||
      !isUuid(payload.probeGeneration) ||
      typeof payload.policyVersion !== 'string' ||
      payload.policyVersion.trim() === '' ||
      typeof payload.deletionFence !== 'number' ||
      !Number.isSafeInteger(payload.deletionFence) ||
      payload.deletionFence < 0 ||
      typeof payload.durationSec !== 'number' ||
      !Number.isSafeInteger(payload.durationSec) ||
      payload.durationSec <= 0 ||
      typeof payload.fullPipelineJobId !== 'string' ||
      !isUuid(payload.fullPipelineJobId) ||
      typeof payload.probeResultId !== 'string' ||
      !isUuid(payload.probeResultId) ||
      locator === undefined ||
      locator.policyVersion !== payload.policyVersion ||
      locator.deletionFence !== payload.deletionFence ||
      payload.durationSec > 7200
    ) {
      throw new Error('Invalid media probe completion outbox payload');
    }

    return {
      deletionFence: payload.deletionFence,
      documentId: payload.documentId,
      durationSec: payload.durationSec,
      fullPipelineJobId: payload.fullPipelineJobId,
      ownerId: payload.ownerId,
      policyVersion: payload.policyVersion,
      probeResultId: payload.probeResultId,
      probeGeneration: payload.probeGeneration,
      locator,
    };
  }

  private parseProbeFailure(payload: Record<string, unknown>): ProbeFailurePayload {
    const errorCode = this.parseFailureCode(payload.errorCode);
    const errorMessage = payload.errorMessage ?? null;
    if (
      payload.version !== 1 ||
      (payload.jobType !== undefined && payload.jobType !== MEDIA_PROBE_JOB_TYPE) ||
      payload.status !== DocumentProcessingResultStatus.FAILED ||
      typeof payload.documentId !== 'string' ||
      !isUuid(payload.documentId) ||
      typeof payload.ownerId !== 'string' ||
      !isUuid(payload.ownerId) ||
      typeof payload.attempt !== 'number' ||
      !Number.isInteger(payload.attempt) ||
      payload.attempt < 1 ||
      typeof payload.leaseId !== 'string' ||
      !isUuid(payload.leaseId) ||
      typeof payload.probeGeneration !== 'string' ||
      !isUuid(payload.probeGeneration) ||
      typeof payload.policyVersion !== 'string' ||
      payload.policyVersion.trim() === '' ||
      typeof payload.deletionFence !== 'number' ||
      !Number.isSafeInteger(payload.deletionFence) ||
      payload.deletionFence < 0 ||
      errorCode === undefined ||
      errorCode === null ||
      (errorMessage !== null && typeof errorMessage !== 'string')
    ) {
      throw new Error('Invalid media probe failure outbox payload');
    }

    return {
      attempt: payload.attempt,
      deletionFence: payload.deletionFence,
      documentId: payload.documentId,
      errorCode,
      errorMessage,
      leaseId: payload.leaseId,
      ownerId: payload.ownerId,
      policyVersion: payload.policyVersion,
      probeGeneration: payload.probeGeneration,
    };
  }

  private parseProbeLocator(value: unknown): ProbeLocatorPayload | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const locator = value as Record<string, unknown>;
    const bucket = typeof locator.bucket === 'string' ? locator.bucket : undefined;
    const key = typeof locator.key === 'string' ? locator.key : undefined;
    const versionId = normalizeStorageVersionId(locator.versionId);
    const etag = typeof locator.etag === 'string' ? locator.etag : undefined;
    const contentLength = locator.contentLength;
    const policyVersion = typeof locator.policyVersion === 'string'
      ? locator.policyVersion
      : undefined;
    const deletionFence = locator.deletionFence;
    if (
      bucket === undefined ||
      bucket.trim() === '' ||
      key === undefined ||
      key.trim() === '' ||
      versionId === undefined ||
      etag === undefined ||
      etag.trim() === '' ||
      typeof contentLength !== 'number' ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      policyVersion === undefined ||
      policyVersion.trim() === '' ||
      typeof deletionFence !== 'number' ||
      !Number.isSafeInteger(deletionFence) ||
      deletionFence < 0
    ) {
      return undefined;
    }
    return {
      bucket,
      contentLength,
      deletionFence,
      etag,
      key,
      policyVersion,
      versionId,
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
  | 'probe-project'
  | 'probe-failure-project'
  | 'quiz-persist'
  | 'document-project'
  | 'outbox-publish';

interface ProbeCompletionPayload {
  readonly deletionFence: number;
  readonly documentId: string;
  readonly durationSec: number;
  readonly fullPipelineJobId: string;
  readonly ownerId: string;
  readonly policyVersion: string;
  readonly probeResultId: string;
  readonly probeGeneration: string;
  readonly locator: ProbeLocatorPayload;
}

interface ProbeFailurePayload extends Omit<DocumentProbeFailureCommand, 'eventCreatedAt'> {}

interface ProbeLocatorPayload {
  readonly bucket: string;
  readonly contentLength: number;
  readonly deletionFence: number;
  readonly etag: string;
  readonly key: string;
  readonly policyVersion: string;
  readonly versionId: string;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
