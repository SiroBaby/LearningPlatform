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
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { ContentRepository } from './repositories/content.repository';

@Injectable()
export class DocumentStatusProjectionService implements DocumentStatusProjection {
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
    if (!document || document.modelSelectionKind !== 'PLAN') return { estimatedCredits: 0, platformModelId: null };
    const model = this.config.ai.platformModels.find((candidate) => candidate.id === document.platformModelId);
    if (!model) throw new Error('Platform model for the Document is no longer configured');
    const { totalCredits } = this.mediaCreditEstimator.estimate({
      durationSeconds: this.resolveBillableDurationSeconds(command),
      model,
    });
    return { estimatedCredits: totalCredits, platformModelId: document.platformModelId };
  }

  /**
   * Single seam for the billable duration. Today it is the container duration reported by the probe;
   * the audio-prep PR (decision D10) swaps this for the decoded duration.
   */
  private resolveBillableDurationSeconds(command: DocumentProbeCompletionCommand): number {
    return command.durationSec;
  }
}
