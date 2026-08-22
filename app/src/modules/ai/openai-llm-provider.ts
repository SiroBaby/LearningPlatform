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
  LlmGenerationResult,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ExtractionError } from './contracts/extraction-error';
import { FakeLlmProvider } from './fake-llm-provider';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';

interface OpenAiClient {
  readonly chat: {
    readonly completions: {
      create(
        input: ChatCompletionCreateParamsNonStreaming,
      ): Promise<OpenAiChatCompletionResult>;
    };
  };
  readonly responses: {
    create(
      input: ResponseCreateParamsNonStreaming,
    ): Promise<Pick<Response, 'output_text' | 'status' | 'usage'>>;
  };
}

interface OpenAiChatCompletionResult {
  readonly choices: readonly {
    readonly finish_reason: string | null;
    readonly message: { readonly content: string | null };
  }[];
  readonly usage?: ChatCompletion['usage'];
}

interface OpenAiProviderSettings {
  readonly model: string;
  readonly providerIdentity: string;
  readonly structuredOutputMode: LlmStructuredOutputMode;
  readonly transport: LlmTransport;
}

export interface OpenAiCompatibleProviderSettings {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly capabilityVersion: string;
  readonly model: string;
  readonly requestTimeoutMs?: number;
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
      maxItems: 1,
      minItems: 1,
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

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    try {
      switch (this.settings.transport) {
        case 'chat-completions':
          return await this.generateChatCompletion(request);
        case 'responses':
          return await this.generateResponse(request);
      }
    } catch (error) {
      if (isProviderUnavailableError(error)) {
        throw new ExtractionError(DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE);
      }
      throw error;
    }
  }

  private async generateChatCompletion(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    const response = await this.client.chat.completions.create({
      max_tokens: request.parameters.maxOutputTokens,
      messages: [
        { content: request.promptTemplate, role: 'system' },
        { content: request.sourceText, role: 'user' },
      ],
      model: this.model,
      response_format: createChatResponseFormat(this.settings.structuredOutputMode),
    });
    if (isGenerationOutputTruncated(response.choices[0]?.finish_reason)) {
      throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_TRUNCATED);
    }
    return { output: parseGeneratedOutput(response.choices[0]?.message.content), usage: mapUsage(response.usage) };
  }

  private async generateResponse(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
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
    return { output: parseGeneratedOutput(response.output_text), usage: mapUsage(response.usage) };
  }
}

function mapUsage(usage: { readonly input_tokens?: number; readonly output_tokens?: number; readonly prompt_tokens?: number; readonly completion_tokens?: number } | null | undefined): LlmGenerationResult['usage'] {
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens)
  ) {
    return { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' };
  }
  return { inputTokens, outputTokens, status: 'AVAILABLE' };
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
  const settings = config.llmProvider;
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
  return createOpenAiCompatibleProvider({ apiKey, baseUrl, capabilityVersion, model, requestTimeoutMs, structuredOutputMode, transport });
}

export function createOpenAiCompatibleProvider(settings: OpenAiCompatibleProviderSettings): LlmProvider {
  const client = new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseUrl, logLevel: 'off', maxRetries: 0, timeout: settings.requestTimeoutMs ?? 60_000 });
  return new OpenAiLlmProvider(client, {
    model: settings.model,
    providerIdentity: createOpenAiProviderIdentity(settings),
    structuredOutputMode: settings.structuredOutputMode,
    transport: settings.transport,
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
  const normalized = normalizeGeneratedJsonOutput(value);
  if (!normalized) {
    throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
  }
  try {
    return JSON.parse(normalized);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
    }
    throw error;
  }
}

function normalizeGeneratedJsonOutput(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('```')) return trimmed;
  const openingFence = '```json\n';
  const closingFence = '\n```';
  if (!trimmed.startsWith(openingFence) || !trimmed.endsWith(closingFence)) return null;
  const inner = trimmed.slice(openingFence.length, -closingFence.length);
  return inner.trim() ? inner : null;
}

function isGenerationOutputTruncated(finishReason: string | null | undefined): boolean {
  return finishReason === 'length' || finishReason === 'max_tokens';
}

function isProviderUnavailableError(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) return false;
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error.status === 429 || (error.status !== undefined && error.status >= 500)) return true;
  return error.status === 404 && error.message.includes('No active credentials for provider');
}
