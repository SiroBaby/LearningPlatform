import { Injectable } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';
import {
  DocumentProbeCompletionCommand,
  DocumentProbeCreditEstimate,
  DocumentProbeCompletionOutcome,
  DocumentProbeFailureCommand,
  DocumentProbeFailureOutcome,
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from './contracts/document-status-projection.port';
import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { MAX_MEDIA_DURATION_SEC } from './contracts/media-probe-policy';
import { ModelPriceTableError } from './credit-estimation/model-price-table';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
  private readonly logger = createApplicationLogger({ context: DocumentStatusProjectionService.name });

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly config: ApplicationConfigService,
    private readonly mediaCreditEstimator: MediaCreditEstimator,
  ) {}

  async completeProbe(command: DocumentProbeCompletionCommand): Promise<DocumentProbeCompletionOutcome> {
    const creditEstimate = await this.estimateCredits(command);
    return this.contentRepository.completeProbe({ ...command, creditEstimate });
  }

  async failProbe(command: DocumentProbeFailureCommand): Promise<DocumentProbeFailureOutcome> {
    return this.contentRepository.failProbe(command);
  }

  async project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome> {
    return this.contentRepository.projectProcessingResult(command);
  }

  private async estimateCredits(command: DocumentProbeCompletionCommand): Promise<DocumentProbeCreditEstimate> {
    const document = await this.contentRepository.findByOwnerId(command.ownerId, command.documentId);
    // Unknown Document / custom model: nothing to reserve; the repository decides IGNORED or zero cost.
    if (!document || document.modelSelectionKind !== 'PLAN') {
      return { kind: 'ESTIMATED', estimatedCredits: 0, platformModelId: null };
    }
    const durationSeconds = this.resolveBillableDurationSeconds(command);
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_MEDIA_DURATION_SEC) {
      return this.unavailable(command, DocumentProcessingFailureCode.MEDIA_PROBE_FAILED, 'invalid_duration');
    }
    const platformModels = this.config.ai.platformModels;
    const model = platformModels.find((candidate) => candidate.id === document.platformModelId);
    // The first configured platform model is the default model that anchors the wallet unit (D2 of #160).
    const defaultModel = platformModels[0];
    if (!model || !defaultModel) {
      return this.unavailable(command, DocumentProcessingFailureCode.MEDIA_PRICING_UNAVAILABLE, 'platform_model_not_configured');
    }
    try {
      const { totalCredits } = this.mediaCreditEstimator.estimate({ defaultModel, durationSeconds, model });
      return { kind: 'ESTIMATED', estimatedCredits: totalCredits, platformModelId: document.platformModelId };
    } catch (error) {
      if (!(error instanceof ModelPriceTableError)) throw error;
      return this.unavailable(command, DocumentProcessingFailureCode.MEDIA_PRICING_UNAVAILABLE, 'price_missing');
    }
  }

  /** A terminal, non-retryable outcome: never throw here, or the return relay would block on this event forever. */
  private unavailable(
    command: DocumentProbeCompletionCommand,
    errorCode: DocumentProcessingFailureCode.MEDIA_PRICING_UNAVAILABLE | DocumentProcessingFailureCode.MEDIA_PROBE_FAILED,
    reason: string,
  ): DocumentProbeCreditEstimate {
    this.logger.error({
      documentId: command.documentId,
      errorCode,
      event: 'content.probe.credit_estimate_unavailable',
      reason,
      runtime: 'worker',
    });
    return { kind: 'UNAVAILABLE', errorCode };
  }

  /**
   * Single seam for the billable duration. Today it is the container duration reported by the probe;
   * the audio-prep PR (decision D10) swaps this for the decoded duration.
   */
  private resolveBillableDurationSeconds(command: DocumentProbeCompletionCommand): number {
    return command.durationSec;
  }
}
