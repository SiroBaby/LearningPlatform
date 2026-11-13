import { describe, expect, it } from '@jest/globals';

import { parseDocumentProcessingUsageBlock } from './document-processing-usage.parser';

describe('parseDocumentProcessingUsageBlock', () => {
  it('parses a complete block and defaults the optional counters', () => {
    const actualUsage = parseDocumentProcessingUsageBlock({ llm: [{ inputTokens: 1, model: 'm', outputTokens: 2 }] });

    expect(actualUsage).toEqual({
      llm: [{ inputTokens: 1, model: 'm', outputTokens: 2 }],
      sttBilledSeconds: null,
      sttUncertainSeconds: null,
      uncertainDispatches: 0,
    });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['missing llm', {}],
    ['negative tokens', { llm: [{ inputTokens: -1, model: 'm', outputTokens: 0 }] }],
    ['blank model', { llm: [{ inputTokens: 0, model: ' ', outputTokens: 0 }] }],
    ['fractional uncertain dispatches', { llm: [], uncertainDispatches: 1.5 }],
    ['negative stt seconds', { llm: [], sttBilledSeconds: -1 }],
  ])('returns null for %s', (_name, input) => {
    expect(parseDocumentProcessingUsageBlock(input)).toBeNull();
  });
});
