import { describe, expect, it } from '@jest/globals';

import { FakeLlmProvider } from './fake-llm-provider';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';

describe('FakeLlmProvider', () => {
  it('returns one deterministic valid MCQ for a nonblank chunk', async () => {
    const provider = new FakeLlmProvider();
    const request = {
      parameters: { format: 'mcq-single-select-v1' as const, maxOutputTokens: 1000 as const, questionsPerChunk: 1 as const },
      promptTemplate: 'template',
      sourceText: 'Grounded source text.',
    };

    const first = await provider.generate(request);
    const second = await provider.generate(request);
    const decoded = decodeGeneratedQuestionOutput(first);

    expect(first).toEqual(second);
    expect(decoded.questions).toHaveLength(1);
    expect(decoded.questions[0]?.options.filter((option) => option.isCorrect)).toHaveLength(1);
  });

  it('returns no questions for a blank chunk', async () => {
    const provider = new FakeLlmProvider();

    const output = await provider.generate({
      parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 1000, questionsPerChunk: 1 },
      promptTemplate: 'template',
      sourceText: ' \n ',
    });

    expect(decodeGeneratedQuestionOutput(output).questions).toEqual([]);
  });
});
