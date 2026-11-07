import { describe, expect, it } from '@jest/globals';

import type { PlanModelCatalogItem } from '../../ai/contracts/model-selection.contracts';
import { estimateTextCredits } from './text-credit-estimator';

const model: PlanModelCatalogItem = {
  creditPerInputToken: 1,
  creditPerOutputToken: 2,
  id: 'platform-default',
  model: 'gpt-5.4-mini',
  planIds: ['free'],
};

describe('estimateTextCredits', () => {
  it.each([
    // 1 chunk: 200 prompt + ceil(1200 / 3) = 600 input; 600 output * 2.
    { name: 'one chunk', chunkCount: 1, extractedChars: 1200, expectedCredits: 600 + 1200 },
    // 10 chunks: 2000 + 4000 = 6000 input; 6000 output * 2.
    { name: 'ten chunks', chunkCount: 10, extractedChars: 12000, expectedCredits: 6000 + 12000 },
    // 1 char rounds up to one token.
    { name: 'a single character', chunkCount: 1, extractedChars: 1, expectedCredits: 201 + 1200 },
  ])('prices the real text for $name', ({ chunkCount, extractedChars, expectedCredits }) => {
    const actualCredits = estimateTextCredits({ chunkCount, extractedChars, model });

    expect(actualCredits).toBe(expectedCredits);
  });

  it('scales with the per-token credits of the selected model', () => {
    const inputExpensiveModel = { ...model, creditPerInputToken: 3, creditPerOutputToken: 5 };

    const actualCredits = estimateTextCredits({ chunkCount: 1, extractedChars: 1200, model: inputExpensiveModel });

    expect(actualCredits).toBe(600 * 3 + 600 * 5);
  });

  it('stays well below the size-based estimate for a text-light PDF (the #281 regression)', () => {
    // The dev PDF was estimated at 61,906 credits from its bytes and really cost 14,501.
    const sizeBasedEstimate = 61_906;

    const actualCredits = estimateTextCredits({ chunkCount: 8, extractedChars: 9_000, model });

    expect(actualCredits).toBeLessThan(sizeBasedEstimate / 4);
  });

  it.each([
    { name: 'no chunks', chunkCount: 0, extractedChars: 100 },
    { name: 'no characters', chunkCount: 1, extractedChars: 0 },
    { name: 'a fractional chunk count', chunkCount: 1.5, extractedChars: 100 },
  ])('rejects $name', ({ chunkCount, extractedChars }) => {
    expect(() => estimateTextCredits({ chunkCount, extractedChars, model })).toThrow(RangeError);
  });
});
