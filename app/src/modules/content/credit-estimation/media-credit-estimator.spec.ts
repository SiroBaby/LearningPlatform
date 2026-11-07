import { describe, expect, it } from '@jest/globals';

import { MediaCreditEstimator } from './media-credit-estimator';
import {
  assertPlatformModelsPriced,
  DEFAULT_MODEL_PRICE_TABLE,
  DEFAULT_STT_MODEL,
  ModelPriceTableError,
  validateModelPriceTable,
  type ModelPriceTable,
} from './model-price-table';

const inputModel = {
  creditPerInputToken: 1,
  creditPerOutputToken: 2,
  id: 'platform-default',
  model: 'gpt-5.4-mini',
  planIds: ['free'],
} as const;
const OLD_SIZE_BASED_ESTIMATE = 6_113_328;

describe('MediaCreditEstimator', () => {
  it('prices a 355 second MP4 by duration, far below the old size-based estimate', () => {
    const inputDurationSeconds = 355;
    const estimator = new MediaCreditEstimator();

    const actualEstimate = estimator.estimate({ durationSeconds: inputDurationSeconds, defaultModel: inputModel, model: inputModel });

    // STT: ceil(355 * 1850 * 1e6 / (60 * 750000)) = 14_595; generation: ceil(355 * 400 / 60) + 256 * 2 = 2_879.
    const expectedEstimate = { generationCredits: 2_879, sttCredits: 14_595, totalCredits: 17_474 };
    expect(actualEstimate).toEqual(expectedEstimate);
    expect(actualEstimate.totalCredits).toBeLessThan(OLD_SIZE_BASED_ESTIMATE / 100);
  });

  it('scales credits with the duration', () => {
    const estimator = new MediaCreditEstimator();

    const actualShort = estimator.estimate({ durationSeconds: 60, defaultModel: inputModel, model: inputModel });
    const actualLong = estimator.estimate({ durationSeconds: 600, defaultModel: inputModel, model: inputModel });

    expect(actualShort.sttCredits).toBe(2_467);
    expect(actualLong.sttCredits).toBe(24_667);
    expect(actualLong.totalCredits).toBeGreaterThan(actualShort.totalCredits);
  });

  it('applies the selected model credit multipliers to generation only', () => {
    const estimator = new MediaCreditEstimator();
    const inputDoubleModel = { ...inputModel, creditPerInputToken: 2 };

    const actualEstimate = estimator.estimate({ durationSeconds: 60, defaultModel: inputModel, model: inputDoubleModel });

    // STT stays anchored to the default model (1 credit per token); only generation uses the selected model's multiplier.
    expect(actualEstimate.sttCredits).toBe(2_467);
    expect(actualEstimate.generationCredits).toBe(400 * 2 + 256 * 2);
  });

  it('anchors STT credits to the default model price, not the selected model price', () => {
    const estimator = new MediaCreditEstimator();
    const inputCheaperSelectedModel = { ...inputModel, id: 'cheap', model: 'gpt-4.1-mini' };

    const actualEstimate = estimator.estimate({ durationSeconds: 355, defaultModel: inputModel, model: inputCheaperSelectedModel });

    // Dividing by the selected model's price ($0.40/M) would give 27,365; the default anchor ($0.75/M) gives 14,595.
    expect(actualEstimate.sttCredits).toBe(14_595);
    expect(actualEstimate.generationCredits).toBe(2_879);
  });

  it('rejects a non-positive or fractional duration', () => {
    const estimator = new MediaCreditEstimator();

    expect(() => estimator.estimate({ durationSeconds: 0, defaultModel: inputModel, model: inputModel })).toThrow(RangeError);
    expect(() => estimator.estimate({ durationSeconds: 1.5, defaultModel: inputModel, model: inputModel })).toThrow(RangeError);
  });

  it('fails fast when the platform model has no price entry', () => {
    const estimator = new MediaCreditEstimator();

    expect(() => estimator.estimate({ durationSeconds: 60, defaultModel: inputModel, model: { ...inputModel, model: 'unpriced-model' } }))
      .toThrow(ModelPriceTableError);
  });
});

describe('validateModelPriceTable', () => {
  it('accepts the default table', () => {
    expect(validateModelPriceTable(DEFAULT_MODEL_PRICE_TABLE)).toBe(DEFAULT_MODEL_PRICE_TABLE);
  });

  it.each<[string, ModelPriceTable]>([
    ['empty version', { ...DEFAULT_MODEL_PRICE_TABLE, version: ' ' }],
    ['no llm prices', { ...DEFAULT_MODEL_PRICE_TABLE, llm: {} }],
    ['no stt prices', { ...DEFAULT_MODEL_PRICE_TABLE, stt: {} }],
    ['zero llm input price', { ...DEFAULT_MODEL_PRICE_TABLE, llm: { m: { inputMicroUsdPerMillionTokens: 0, outputMicroUsdPerMillionTokens: 1 } } }],
    ['fractional llm output price', { ...DEFAULT_MODEL_PRICE_TABLE, llm: { m: { inputMicroUsdPerMillionTokens: 1, outputMicroUsdPerMillionTokens: 1.5 } } }],
    ['negative stt price', { ...DEFAULT_MODEL_PRICE_TABLE, stt: { [DEFAULT_STT_MODEL]: { microUsdPerMinute: -1 } } }],
  ])('rejects %s', (_label, inputTable) => {
    expect(() => validateModelPriceTable(inputTable)).toThrow(ModelPriceTableError);
  });

  it('fails fast at boot when media is enabled and a platform model is unpriced', () => {
    const inputConfig = { ai: { platformModels: [{ model: 'gpt-5.4-mini' }, { model: 'unpriced-model' }] }, storage: { mediaEnabled: true } };
    const estimator = new MediaCreditEstimator(undefined, inputConfig as never);

    expect(() => estimator.onModuleInit()).toThrow(/unpriced-model/u);
  });

  it('passes the boot check when every platform model and the STT model are priced', () => {
    const inputConfig = { ai: { platformModels: [{ model: 'gpt-5.4-mini' }, { model: 'gpt-4.1-mini' }] }, storage: { mediaEnabled: true } };

    expect(() => new MediaCreditEstimator(undefined, inputConfig as never).onModuleInit()).not.toThrow();
  });

  it('skips the boot check while media uploads are disabled', () => {
    const inputConfig = { ai: { platformModels: [{ model: 'unpriced-model' }] }, storage: { mediaEnabled: false } };

    expect(() => new MediaCreditEstimator(undefined, inputConfig as never).onModuleInit()).not.toThrow();
  });

  it('fails the boot check when the STT model has no price', () => {
    expect(() => assertPlatformModelsPriced({ ...DEFAULT_MODEL_PRICE_TABLE, stt: { other: { microUsdPerMinute: 1 } } }, ['gpt-5.4-mini'])).toThrow(/STT/u);
  });

  it('is enforced when constructing the estimator', () => {
    expect(() => new MediaCreditEstimator({ ...DEFAULT_MODEL_PRICE_TABLE, stt: {} })).toThrow(ModelPriceTableError);
  });

  describe('calculateActual', () => {
    const inputUsage = {
      llm: [{ inputTokens: 1_000, model: 'gpt-5.4-mini', outputTokens: 500 }],
      sttBilledSeconds: null,
      sttUncertainSeconds: null,
      uncertainDispatches: 0,
    };

    it('prices LLM tokens with the selected model credit multipliers and derives the micro-USD cost', () => {
      const estimator = new MediaCreditEstimator();

      const actualResult = estimator.calculateActual({ defaultModel: inputModel, model: inputModel, usage: inputUsage });

      // credits: 1000 * 1 + 500 * 2; cost: ceil(1000 * 750000 / 1e6) + ceil(500 * 4500000 / 1e6) = 750 + 2250.
      expect(actualResult).toEqual({
        costMicroUsd: 3_000,
        generationCredits: 2_000,
        priceTableVersion: DEFAULT_MODEL_PRICE_TABLE.version,
        sttCredits: 0,
        totalCredits: 2_000,
      });
    });

    it('converts billed STT seconds with the same price-anchored formula as the estimate', () => {
      const estimator = new MediaCreditEstimator();
      const inputSeconds = 355;
      const expectedSttCredits = estimator.estimate({ defaultModel: inputModel, durationSeconds: inputSeconds, model: inputModel }).sttCredits;

      const actualResult = estimator.calculateActual({
        defaultModel: inputModel,
        model: inputModel,
        usage: { ...inputUsage, llm: [], sttBilledSeconds: inputSeconds },
      });

      expect(actualResult.sttCredits).toBe(expectedSttCredits);
      expect(actualResult.totalCredits).toBe(expectedSttCredits);
      const sttPrice = DEFAULT_MODEL_PRICE_TABLE.stt[DEFAULT_STT_MODEL];
      expect(actualResult.costMicroUsd).toBe(Math.ceil((inputSeconds * (sttPrice?.microUsdPerMinute ?? 0)) / 60));
    });

    it('returns zero for an attempt that spent nothing', () => {
      const estimator = new MediaCreditEstimator();

      const actualResult = estimator.calculateActual({
        defaultModel: inputModel,
        model: inputModel,
        usage: { ...inputUsage, llm: [] },
      });

      expect(actualResult).toMatchObject({ costMicroUsd: 0, totalCredits: 0 });
    });

    it('keeps credits but reports no cost when a reported model has no price', () => {
      const estimator = new MediaCreditEstimator();

      const actualResult = estimator.calculateActual({
        defaultModel: inputModel,
        model: inputModel,
        usage: { ...inputUsage, llm: [{ inputTokens: 10, model: 'unpriced-model', outputTokens: 10 }] },
      });

      expect(actualResult.totalCredits).toBe(30);
      expect(actualResult.costMicroUsd).toBeNull();
    });
  });
});
