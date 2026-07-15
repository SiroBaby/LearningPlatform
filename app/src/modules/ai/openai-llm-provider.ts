import OpenAI from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type {
  LlmGenerationRequest,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import { FakeLlmProvider } from './fake-llm-provider';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';

interface OpenAiResponsesClient {
  readonly responses: {
    create(input: ResponseCreateParamsNonStreaming): Promise<Pick<Response, 'output_text' | 'status'>>;
  };
}

const QUIZ_RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    questions: {
      items: {
        additionalProperties: false,
        properties: {
          explanation: { type: 'string' },
          options: {
            items: {
              additionalProperties: false,
              properties: {
                content: { type: 'string' },
                isCorrect: { type: 'boolean' },
              },
              required: ['content', 'isCorrect'],
              type: 'object',
            },
            type: 'array',
          },
          stem: { type: 'string' },
        },
        required: ['explanation', 'options', 'stem'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['questions'],
  type: 'object',
} as const;

export class OpenAiLlmProvider implements LlmProvider {
  constructor(
    private readonly client: OpenAiResponsesClient,
    readonly model: string,
  ) {}

  async generate(request: LlmGenerationRequest): Promise<unknown> {
    const response = await this.client.responses.create({
      input: request.sourceText,
      instructions: request.promptTemplate,
      max_output_tokens: request.parameters.maxOutputTokens,
      model: this.model,
      store: false,
      text: {
        format: {
          name: 'quiz_questions',
          schema: QUIZ_RESPONSE_SCHEMA,
          strict: true,
          type: 'json_schema',
        },
      },
    });
    if (response.status !== 'completed' || response.output_text.trim().length === 0) {
      throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
    }
    try {
      const output: unknown = JSON.parse(response.output_text);
      return output;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
      }
      throw error;
    }
  }
}

export function createLlmProvider(config: ApplicationConfigService): LlmProvider {
  const settings = config.ai;
  if (settings.provider === 'fake') return new FakeLlmProvider();
  const { apiKey, model, requestTimeoutMs } = settings.openai;
  if (!apiKey || !model) {
    throw new Error('OpenAI provider configuration was not validated');
  }
  const client = new OpenAI({
    apiKey,
    logLevel: 'off',
    maxRetries: 2,
    timeout: requestTimeoutMs,
  });
  return new OpenAiLlmProvider(client, model);
}
