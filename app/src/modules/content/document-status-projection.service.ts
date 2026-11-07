import { Injectable } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';
import {
  DocumentExtractionCompletionCommand,
  DocumentExtractionCompletionOutcome,
  DocumentExtractionCreditEstimate,
  DocumentProbeCompletionCommand,
  DocumentProbeCreditEstimate,
  DocumentProbeCompletionOutcome,
  DocumentProbeFailureCommand,
  DocumentProbeFailureOutcome,
  DocumentSettlementPlan,
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
  DocumentStatusProjectionOutcome,
} from './contracts/document-status-projection.port';
import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import { DocumentStatus } from './enums/document-status.enum';
import {
  DocumentProcessingFailureCode,
  isFailureBeforeProviderDispatch,
} from '../ai/contracts/document-processing-result';
import { MAX_MEDIA_DURATION_SEC } from './contracts/media-probe-policy';
import { ModelPriceTableError } from './credit-estimation/model-price-table';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { estimateTextCredits } from './credit-estimation/text-credit-estimator';
import { ContentRepository } from './repositories/content.repository';

interface SettlementPlanning {
  readonly logActualUsage?: () => void;
  readonly settlement: DocumentSettlementPlan | null;
}

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
  private readonly logger = createApplicationLogger({ context: DocumentStatusProjectionService.name });

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly config: ApplicationConfigService,
    private readonly mediaCreditEstimator: MediaCreditEstimator,
  ) {}

  async completeExtraction(command: DocumentExtractionCompletionCommand): Promise<DocumentExtractionCompletionOutcome> {
    const creditEstimate = await this.estimateExtractedTextCredits(command);
    return this.contentRepository.completeExtraction({ ...command, creditEstimate });
  }

  /** Never throws for config problems: a poisoned return event would block the relay, so it fails the Document. */
  private async estimateExtractedTextCredits(
    command: DocumentExtractionCompletionCommand,
  ): Promise<DocumentExtractionCreditEstimate> {
    const document = await this.contentRepository.findByOwnerId(command.ownerId, command.documentId);
    if (!document || document.modelSelectionKind !== 'PLAN') {
      return { kind: 'ESTIMATED', estimatedCredits: 0, platformModelId: null };
    }
    const model = this.config.ai.platformModels.find((candidate) => candidate.id === document.platformModelId);
    if (!model) {
      this.logger.error({
        documentId: command.documentId,
        event: 'content.extraction.credit_estimate_unavailable',
        reason: 'platform_model_not_configured',
        runtime: 'worker',
      });
      return { kind: 'UNAVAILABLE' };
    }
    try {
      return {
        kind: 'ESTIMATED',
        estimatedCredits: estimateTextCredits({
          chunkCount: command.chunkCount,
          extractedChars: command.extractedChars,
          model,
        }),
        platformModelId: document.platformModelId,
      };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      this.logger.error({
        documentId: command.documentId,
        event: 'content.extraction.credit_estimate_unavailable',
        reason: 'invalid_measurement',
        runtime: 'worker',
      });
      return { kind: 'UNAVAILABLE' };
    }
  }

  async completeProbe(command: DocumentProbeCompletionCommand): Promise<DocumentProbeCompletionOutcome> {
    const creditEstimate = await this.estimateCredits(command);
    return this.contentRepository.completeProbe({ ...command, creditEstimate });
  }

  async failProbe(command: DocumentProbeFailureCommand): Promise<DocumentProbeFailureOutcome> {
    return this.contentRepository.failProbe(command);
  }

  async project(command: DocumentStatusProjectionCommand): Promise<DocumentStatusProjectionOutcome> {
    const { settlement, logActualUsage } = await this.planSettlement(command);
    const outcome = await this.contentRepository.projectProcessingResult({ ...command, settlement });
    // Only a projection that was applied settles; an IGNORED/ALREADY_APPLIED event must not log a settlement.
    if (outcome === 'APPLIED') logActualUsage?.();
    return outcome;
  }

  /**
   * Decides how to settle the reservation of a finished attempt (ADR-0022). Never throws for pricing problems:
   * a poisoned return event would block the relay, so an unpriced result is held instead of guessed.
   *  - usage reported: settle the actual credits; HELD when some provider dispatch has an unknown outcome;
   *  - usage absent (payload from an older worker): FAILED before any provider call releases everything,
   *    anything else may have spent credits unobserved and stays HELD.
   */
  private async planSettlement(command: DocumentStatusProjectionCommand): Promise<SettlementPlanning> {
    const document = await this.contentRepository.findByOwnerId(command.ownerId, command.documentId);
    if (!document || document.modelSelectionKind !== 'PLAN') return { settlement: null };
    const { usage } = command;
    if (!usage) {
      const isKnownUnspent = command.status === DocumentStatus.FAILED && isFailureBeforeProviderDispatch(command.errorCode);
      return { settlement: { hasUncertainDispatch: !isKnownUnspent, knownActualCredits: 0 } };
    }
    const hasUncertainDispatch = usage.uncertainDispatches > 0 || (usage.sttUncertainSeconds ?? 0) > 0;
    const platformModels = this.config.ai.platformModels;
    const model = platformModels.find((candidate) => candidate.id === document.platformModelId);
    const defaultModel = platformModels[0];
    if (!model || !defaultModel) {
      this.logSettlementUnpriced(command, 'platform_model_not_configured');
      return { settlement: { hasUncertainDispatch: true, knownActualCredits: 0 } };
    }
    try {
      const actual = this.mediaCreditEstimator.calculateActual({ defaultModel, model, usage });
      return {
        logActualUsage: () => this.logger.log({
          actualCostMicroUsd: actual.costMicroUsd,
          documentId: command.documentId,
          event: 'content.settlement.actual_usage',
          generationCredits: actual.generationCredits,
          hasUncertainDispatch,
          jobId: command.jobId,
          priceTableVersion: actual.priceTableVersion,
          runtime: 'worker',
          sttCredits: actual.sttCredits,
          totalCredits: actual.totalCredits,
        }),
        settlement: { hasUncertainDispatch, knownActualCredits: actual.totalCredits },
      };
    } catch (error) {
      if (!(error instanceof ModelPriceTableError)) throw error;
      this.logSettlementUnpriced(command, 'price_missing');
      return { settlement: { hasUncertainDispatch: true, knownActualCredits: 0 } };
    }
  }

  private logSettlementUnpriced(command: DocumentStatusProjectionCommand, reason: string): void {
    this.logger.error({
      documentId: command.documentId,
      event: 'content.settlement.unpriced',
      jobId: command.jobId,
      reason,
      runtime: 'worker',
    });
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
