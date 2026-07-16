import { createHash } from 'crypto';

import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions/completions';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFormatTextConfig,
} from 'openai/resources/responses/responses';
import type {
  ResponseFormatJSONObject,
  ResponseFormatJSONSchema,
} from 'openai/resources/shared';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type {
  LlmStructuredOutputMode,
  LlmTransport,
} from '../../config/configuration.types';
import type {
  LlmGenerationRequest,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import { FakeLlmProvider } from './fake-llm-provider';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';

interface OpenAiClient {
  readonly chat: {
    readonly completions: {
      create(
        input: ChatCompletionCreateParamsNonStreaming,
      ): Promise<Pick<ChatCompletion, 'choices'>>;
    };
  };
  readonly responses: {
    create(
      input: ResponseCreateParamsNonStreaming,
    ): Promise<Pick<Response, 'output_text' | 'status'>>;
  };
}

interface OpenAiProviderSettings {
  readonly model: string;
  readonly providerIdentity: string;
  readonly structuredOutputMode: LlmStructuredOutputMode;
  readonly transport: LlmTransport;
}

export interface OpenAiProviderIdentityInput {
  readonly baseUrl: string;
  readonly capabilityVersion: string;
  readonly model: string;
  readonly structuredOutputMode: LlmStructuredOutputMode;
  readonly transport: LlmTransport;
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
  readonly model: string;
  readonly providerIdentity: string;

  constructor(
    private readonly client: OpenAiClient,
    private readonly settings: OpenAiProviderSettings,
  ) {
    this.model = settings.model;
    this.providerIdentity = settings.providerIdentity;
  }

  async generate(request: LlmGenerationRequest): Promise<unknown> {
    switch (this.settings.transport) {
      case 'chat-completions':
        return this.generateChatCompletion(request);
      case 'responses':
        return this.generateResponse(request);
    }
  }

  private async generateChatCompletion(request: LlmGenerationRequest): Promise<unknown> {
    const response = await this.client.chat.completions.create({
      max_tokens: request.parameters.maxOutputTokens,
      messages: [
        { content: request.promptTemplate, role: 'system' },
        { content: request.sourceText, role: 'user' },
      ],
      model: this.model,
      response_format: createChatResponseFormat(this.settings.structuredOutputMode),
    });
    return parseGeneratedOutput(response.choices[0]?.message.content);
  }

  private async generateResponse(request: LlmGenerationRequest): Promise<unknown> {
    const response = await this.client.responses.create({
      input: request.sourceText,
      instructions: request.promptTemplate,
      max_output_tokens: request.parameters.maxOutputTokens,
      model: this.model,
      store: false,
      text: { format: createResponsesFormat(this.settings.structuredOutputMode) },
    });
    if (response.status !== 'completed') {
      throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
    }
    return parseGeneratedOutput(response.output_text);
  }
}

export function createOpenAiProviderIdentity(input: OpenAiProviderIdentityInput): string {
  return createHash('sha256').update([
    'provider-type',
    'openai-compatible',
    'base-url',
    input.baseUrl,
    'model',
    input.model,
    'transport',
    input.transport,
    'structured-output-mode',
    input.structuredOutputMode,
    'capability-version',
    input.capabilityVersion,
  ].join('\n')).digest('hex');
}

export function createLlmProvider(config: ApplicationConfigService): LlmProvider {
  const settings = config.ai;
  if (settings.provider === 'fake') return new FakeLlmProvider();
  const {
    apiKey,
    baseUrl,
    capabilityVersion,
    model,
    requestTimeoutMs,
    structuredOutputMode,
    transport,
  } = settings.openai;
  if (
    !apiKey ||
    !baseUrl ||
    !capabilityVersion ||
    !model ||
    !structuredOutputMode ||
    !transport
  ) {
    throw new Error('OpenAI-compatible provider configuration was not validated');
  }
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    logLevel: 'off',
    maxRetries: 2,
    timeout: requestTimeoutMs,
  });
  return new OpenAiLlmProvider(client, {
    model,
    providerIdentity: createOpenAiProviderIdentity({
      baseUrl,
      capabilityVersion,
      model,
      structuredOutputMode,
      transport,
    }),
    structuredOutputMode,
    transport,
  });
}

function createChatResponseFormat(
  mode: LlmStructuredOutputMode,
): ResponseFormatJSONObject | ResponseFormatJSONSchema {
  switch (mode) {
    case 'json-object':
      return { type: 'json_object' };
    case 'json-schema-strict':
      return {
        json_schema: {
          name: 'quiz_questions',
          schema: QUIZ_RESPONSE_SCHEMA,
          strict: true,
        },
        type: 'json_schema',
      };
  }
}

function createResponsesFormat(mode: LlmStructuredOutputMode): ResponseFormatTextConfig {
  switch (mode) {
    case 'json-object':
      return { type: 'json_object' };
    case 'json-schema-strict':
      return {
        name: 'quiz_questions',
        schema: QUIZ_RESPONSE_SCHEMA,
        strict: true,
        type: 'json_schema',
      };
  }
}

function parseGeneratedOutput(value: string | null | undefined): unknown {
  if (!value?.trim()) {
    throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
    }
    throw error;
  }
}
