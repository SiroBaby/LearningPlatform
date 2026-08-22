import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';

import type {
  JsonValue,
  LlmGenerationRequest,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import { normalizeGenerationInput } from './quiz-generation.prompt';

@Injectable()
export class FakeLlmProvider implements LlmProvider {
  readonly model = 'fake-llm-v1';
  readonly providerIdentity = 'fake:fake-llm-v1';

  async generate(request: LlmGenerationRequest): Promise<{ readonly output: JsonValue; readonly usage: { readonly inputTokens: null; readonly outputTokens: null; readonly status: 'UNAVAILABLE' } }> {
    const sourceText = normalizeGenerationInput(request.sourceText);
    if (!sourceText.trim()) return { output: { questions: [] }, usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' } };
    const identifier = createHash('sha256').update(sourceText).digest('hex').slice(0, 12);
    return {
      output: { questions: [{
        explanation: `The answer is stated in source chunk ${identifier}.`,
        options: [
          { content: sourceText, isCorrect: true },
          { content: `Unsupported alternative ${identifier}.`, isCorrect: false },
        ],
        stem: `Which statement is supported by source chunk ${identifier}?`,
      }] },
      usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' },
    };
  }
}
