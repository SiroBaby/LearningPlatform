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

  async generate(request: LlmGenerationRequest): Promise<JsonValue> {
    const sourceText = normalizeGenerationInput(request.sourceText);
    if (!sourceText.trim()) return { questions: [] };
    const identifier = createHash('sha256').update(sourceText).digest('hex').slice(0, 12);
    return {
      questions: [{
        explanation: `The answer is stated in source chunk ${identifier}.`,
        options: [
          { content: sourceText, isCorrect: true },
          { content: `Unsupported alternative ${identifier}.`, isCorrect: false },
        ],
        stem: `Which statement is supported by source chunk ${identifier}?`,
      }],
    };
  }
}
