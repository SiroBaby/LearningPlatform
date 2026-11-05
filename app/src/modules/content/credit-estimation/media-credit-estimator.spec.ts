import { describe, expect, it } from '@jest/globals';

import { MediaCreditEstimator } from './media-credit-estimator';
import {
  DEFAULT_MODEL_PRICE_TABLE,
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

    const actualEstimate = estimator.estimate({ durationSeconds: inputDurationSeconds, model: inputModel });

    // STT: ceil(355 * 6000 * 1e6 / (60 * 750000)) = 47_334; generation: ceil(355 * 400 / 60) + 256 * 2 = 2_879.
    const expectedEstimate = { generationCredits: 2_879, sttCredits: 47_334, totalCredits: 50_213 };
    expect(actualEstimate).toEqual(expectedEstimate);
    expect(actualEstimate.totalCredits).toBeLessThan(OLD_SIZE_BASED_ESTIMATE / 100);
  });

  it('scales credits with the duration', () => {
    const estimator = new MediaCreditEstimator();

    const actualShort = estimator.estimate({ durationSeconds: 60, model: inputModel });
    const actualLong = estimator.estimate({ durationSeconds: 600, model: inputModel });

    expect(actualShort.sttCredits).toBe(8_000);
    expect(actualLong.sttCredits).toBe(80_000);
    expect(actualLong.totalCredits).toBeGreaterThan(actualShort.totalCredits);
  });

  it('applies the credit multipliers of the platform model', () => {
    const estimator = new MediaCreditEstimator();
    const inputDoubleModel = { ...inputModel, creditPerInputToken: 2 };

    const actualEstimate = estimator.estimate({ durationSeconds: 60, model: inputDoubleModel });

    expect(actualEstimate.sttCredits).toBe(16_000);
    expect(actualEstimate.generationCredits).toBe(400 * 2 + 256 * 2);
  });

  it('rejects a non-positive or fractional duration', () => {
    const estimator = new MediaCreditEstimator();

    expect(() => estimator.estimate({ durationSeconds: 0, model: inputModel })).toThrow(RangeError);
    expect(() => estimator.estimate({ durationSeconds: 1.5, model: inputModel })).toThrow(RangeError);
  });

  it('fails fast when the platform model has no price entry', () => {
    const estimator = new MediaCreditEstimator();

    expect(() => estimator.estimate({ durationSeconds: 60, model: { ...inputModel, model: 'unpriced-model' } }))
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
    ['negative stt price', { ...DEFAULT_MODEL_PRICE_TABLE, stt: { 'whisper-1': { microUsdPerMinute: -1 } } }],
  ])('rejects %s', (_label, inputTable) => {
    expect(() => validateModelPriceTable(inputTable)).toThrow(ModelPriceTableError);
  });

  it('is enforced when constructing the estimator', () => {
    expect(() => new MediaCreditEstimator({ ...DEFAULT_MODEL_PRICE_TABLE, stt: {} })).toThrow(ModelPriceTableError);
  });
});
