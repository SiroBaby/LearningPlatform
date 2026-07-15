import { describe, expect, it } from '@jest/globals';

import type { JsonValue } from './contracts/llm-provider.contracts';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';

describe('decodeGeneratedQuestionOutput', () => {
  it('accepts the exact structured output shape', () => {
    const output: JsonValue = {
      questions: [{
        explanation: 'The source supports this answer.',
        options: [
          { content: 'Correct', isCorrect: true },
          { content: 'Incorrect', isCorrect: false },
        ],
        stem: 'Which statement is supported?',
      }],
    };

    expect(decodeGeneratedQuestionOutput(output).questions).toHaveLength(1);
  });

  it('rejects unknown properties instead of caching a permissive payload', () => {
    const output: JsonValue = {
      questions: [{
        explanation: 'The source supports this answer.',
        options: [
          { content: 'Correct', isCorrect: true, score: 1 },
          { content: 'Incorrect', isCorrect: false },
        ],
        stem: 'Which statement is supported?',
      }],
    };

    expect(() => decodeGeneratedQuestionOutput(output)).toThrow(expect.objectContaining({
      code: 'GENERATION_OUTPUT_INVALID',
    }));
  });
});
