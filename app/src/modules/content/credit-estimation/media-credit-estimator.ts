import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';

import { ApplicationConfigService } from '../../../config/application-config.service';
import type { PlanModelCatalogItem } from '../../ai/contracts/model-selection.contracts';
import { COARSE_OUTPUT_TOKEN_CAP } from './credit-estimation.constants';
import {
  DEFAULT_MODEL_PRICE_TABLE,
  assertPlatformModelsPriced,
  DEFAULT_STT_MODEL,
  ModelPriceTableError,
  validateModelPriceTable,
  type ModelPriceTable,
} from './model-price-table';

export const MODEL_PRICE_TABLE = Symbol('MODEL_PRICE_TABLE');

const SECONDS_PER_MINUTE = 60;
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/**
 * Conservative transcript size per minute of speech. Vietnamese speech is roughly 150-200 syllables
 * per minute and BPE tokenizers spend about 2 tokens per Vietnamese syllable, so ~360 tokens/min is
 * typical; 400 rounds up. Heuristic, not measured: recalibrate with real fixtures (PR5/PR7).
 */
export const TRANSCRIPT_TOKENS_PER_MINUTE = 400;

export interface MediaCreditEstimateInput {
  /** Billable duration in whole seconds (probe metadata today; decoded duration after D10). */
  readonly durationSeconds: number;
  /**
   * The configured default platform model. It anchors the wallet unit (D2 of #160): one credit is one input
   * token of this model, so STT cost is converted with ITS input price whatever model the Document selected.
   */
  readonly defaultModel: PlanModelCatalogItem;
  /** The model selected for the Document; it prices only the quiz-generation part. */
  readonly model: PlanModelCatalogItem;
}

export interface MediaCreditEstimate {
  readonly generationCredits: number;
  readonly sttCredits: number;
  readonly totalCredits: number;
}

/**
 * Pure domain service: STT credits for the probed duration plus the credits of generating a quiz
 * from the expected transcript. No I/O.
 *
 *   sttCredits        = ceil(minutes * sttPricePerMinute / defaultModelInputPricePerToken) * defaultModel.creditPerInputToken
 *   generationCredits = ceil(minutes * TRANSCRIPT_TOKENS_PER_MINUTE) * model.creditPerInputToken
 *                       + COARSE_OUTPUT_TOKEN_CAP * model.creditPerOutputToken
 */
@Injectable()
export class MediaCreditEstimator implements OnModuleInit {
  private readonly priceTable: ModelPriceTable;

  constructor(
    @Optional() @Inject(MODEL_PRICE_TABLE) priceTable?: ModelPriceTable,
    @Optional() private readonly config?: ApplicationConfigService,
  ) {
    this.priceTable = validateModelPriceTable(priceTable ?? DEFAULT_MODEL_PRICE_TABLE);
  }

  /** Fail fast at boot when media is enabled but a configured platform model (or the STT model) has no price. */
  onModuleInit(): void {
    if (!this.config?.storage.mediaEnabled) return;
    assertPlatformModelsPriced(this.priceTable, this.config.ai.platformModels.map((model) => model.model));
  }

  estimate(input: MediaCreditEstimateInput): MediaCreditEstimate {
    if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0) {
      throw new RangeError('Media duration must be a positive whole number of seconds');
    }
    const sttCredits = this.estimateSttCredits(input);
    const generationCredits = this.estimateGenerationCredits(input);
    return { generationCredits, sttCredits, totalCredits: Math.max(1, sttCredits + generationCredits) };
  }

  private estimateSttCredits({ defaultModel, durationSeconds }: MediaCreditEstimateInput): number {
    const sttPrice = this.priceTable.stt[DEFAULT_STT_MODEL];
    const llmPrice = this.priceTable.llm[defaultModel.model];
    if (!sttPrice) throw new ModelPriceTableError(`No STT price for model ${DEFAULT_STT_MODEL}`);
    if (!llmPrice) throw new ModelPriceTableError(`No price for platform model ${defaultModel.model}`);
    // tokens = seconds/60 * sttMicroUsdPerMinute / (inputMicroUsdPerMillion / 1e6), kept in integers.
    const numerator = durationSeconds * sttPrice.microUsdPerMinute * TOKENS_PER_PRICE_UNIT;
    const denominator = SECONDS_PER_MINUTE * llmPrice.inputMicroUsdPerMillionTokens;
    return Math.ceil(numerator / denominator) * defaultModel.creditPerInputToken;
  }

  private estimateGenerationCredits({ durationSeconds, model }: MediaCreditEstimateInput): number {
    // The selected model must be priced too, so an unpriced model is rejected instead of silently accepted.
    if (!this.priceTable.llm[model.model]) throw new ModelPriceTableError(`No price for platform model ${model.model}`);
    const transcriptTokens = Math.ceil((durationSeconds * TRANSCRIPT_TOKENS_PER_MINUTE) / SECONDS_PER_MINUTE);
    return transcriptTokens * model.creditPerInputToken + COARSE_OUTPUT_TOKEN_CAP * model.creditPerOutputToken;
  }
}
