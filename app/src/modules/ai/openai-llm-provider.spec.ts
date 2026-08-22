import { describe, expect, it } from '@jest/globals';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions/completions';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { ApplicationConfigService } from '../../config/application-config.service';
import type {
  LlmStructuredOutputMode,
  LlmTransport,
} from '../../config/configuration.types';
import { FakeLlmProvider } from './fake-llm-provider';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';
import { QUIZ_GENERATION_PARAMETERS } from './quiz-generation.prompt';
import {
  createOpenAiProviderIdentity,
  createLlmProvider,
  OpenAiLlmProvider,
} from './openai-llm-provider';

const VALID_OUTPUT = JSON.stringify({
  questions: [{
    explanation: 'Grounded explanation',
    options: [
      { content: 'Correct', isCorrect: true },
      { content: 'Incorrect', isCorrect: false },
    ],
    stem: 'What is supported?',
  }],
});

describe('OpenAiLlmProvider', () => {
  it.each([
    ['responses', 'json-schema-strict'],
    ['responses', 'json-object'],
    ['chat-completions', 'json-schema-strict'],
    ['chat-completions', 'json-object'],
  ] satisfies readonly (readonly [LlmTransport, LlmStructuredOutputMode])[])(
    'generates valid output with %s and %s',
    async (transport, structuredOutputMode) => {
      const client = new RecordingOpenAiClient(VALID_OUTPUT);
      const provider = new OpenAiLlmProvider(client, {
        model: 'gpt-test',
        providerIdentity: 'provider-test',
        structuredOutputMode,
        transport,
      });

      const output = await provider.generate({
        parameters: {
          format: 'mcq-single-select-v1',
          maxOutputTokens: 8000,
          questionsPerChunk: 1,
        },
        promptTemplate: 'Use only the supplied source.',
        sourceText: 'One grounded chunk.',
      });

      expect(decodeGeneratedQuestionOutput(output.output).questions).toHaveLength(1);
      if (transport === 'responses') {
        expect(client.responseRequests[0]).toMatchObject({
          input: 'One grounded chunk.',
          instructions: 'Use only the supplied source.',
          max_output_tokens: QUIZ_GENERATION_PARAMETERS.maxOutputTokens,
          model: 'gpt-test',
          store: false,
          text: {
            format: structuredOutputMode === 'json-schema-strict'
              ? { name: 'quiz_questions', strict: true, type: 'json_schema' }
              : { type: 'json_object' },
          },
        });
        expect(client.chatRequests).toHaveLength(0);
        return;
      }
      expect(client.chatRequests[0]).toMatchObject({
        max_tokens: QUIZ_GENERATION_PARAMETERS.maxOutputTokens,
        messages: [
          { content: 'Use only the supplied source.', role: 'system' },
          { content: 'One grounded chunk.', role: 'user' },
        ],
        model: 'gpt-test',
        response_format: structuredOutputMode === 'json-schema-strict'
          ? { json_schema: { name: 'quiz_questions', strict: true }, type: 'json_schema' }
          : { type: 'json_object' },
      });
      expect(client.responseRequests).toHaveLength(0);
    },
  );

  it('uses the shared quiz generation output-token cap when building provider requests', async () => {
    const client = new RecordingOpenAiClient(VALID_OUTPUT);
    const provider = new OpenAiLlmProvider(client, providerSettings('chat-completions'));

    await provider.generate({
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptTemplate: 'Use only the supplied source.',
      sourceText: 'One grounded chunk.',
    });

    expect(QUIZ_GENERATION_PARAMETERS.maxOutputTokens).toBe(8000);
    expect(client.chatRequests[0]).toMatchObject({
      max_tokens: QUIZ_GENERATION_PARAMETERS.maxOutputTokens,
    });
  });

  it.each(['responses', 'chat-completions'] satisfies readonly LlmTransport[])(
    'enforces exactly one question in the strict schema for %s',
    async (transport) => {
      const client = new RecordingOpenAiClient(VALID_OUTPUT);
      const provider = new OpenAiLlmProvider(client, {
        ...providerSettings(transport),
        structuredOutputMode: 'json-schema-strict',
      });

      await provider.generate({
        parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
        promptTemplate: 'template',
        sourceText: 'source',
      });

      if (transport === 'responses') {
        expect(client.responseRequests[0]?.text?.format).toMatchObject({
          schema: { properties: { questions: { maxItems: 1, minItems: 1 } } },
        });
        return;
      }
      expect(client.chatRequests[0]?.response_format).toMatchObject({
        json_schema: { schema: { properties: { questions: { maxItems: 1, minItems: 1 } } } },
      });
    },
  );

  it('maps incomplete, missing, or non-JSON output to a safe generation error', async () => {
    const request = {
      parameters: {
        format: 'mcq-single-select-v1' as const,
        maxOutputTokens: 8000 as const,
        questionsPerChunk: 1 as const,
      },
      promptTemplate: 'template',
      sourceText: 'source',
    };
    const incomplete = new OpenAiLlmProvider(
      new RecordingOpenAiClient('', 'incomplete'),
      providerSettings('responses'),
    );
    const missing = new OpenAiLlmProvider(
      new RecordingOpenAiClient(null),
      providerSettings('chat-completions'),
    );
    const invalidJson = new OpenAiLlmProvider(
      new RecordingOpenAiClient('not-json'),
      providerSettings('chat-completions'),
    );

    await expect(incomplete.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
    await expect(missing.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
    await expect(invalidJson.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
  });

  it('accepts exactly one complete outer json fence from chat completions', async () => {
    const provider = new OpenAiLlmProvider(
      new RecordingOpenAiClient(`\n\`\`\`json\n${VALID_OUTPUT}\n\`\`\`\n`),
      providerSettings('chat-completions'),
    );

    const result = await provider.generate({
      parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
      promptTemplate: 'template',
      sourceText: 'source',
    });

    expect(decodeGeneratedQuestionOutput(result.output).questions).toHaveLength(1);
  });

  it.each([
    `Prose before\n\`\`\`json\n${VALID_OUTPUT}\n\`\`\``,
    `\`\`\`json\n${VALID_OUTPUT}\n\`\`\`\n\`\`\`json\n${VALID_OUTPUT}\n\`\`\``,
    `\`\`\`json\n${VALID_OUTPUT}`,
    '```json\n\n```',
    `\`\`\`text\n${VALID_OUTPUT}\n\`\`\``,
  ])('rejects non-canonical fenced chat output', async (output) => {
    const provider = new OpenAiLlmProvider(
      new RecordingOpenAiClient(output),
      providerSettings('chat-completions'),
    );

    await expect(provider.generate({
      parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
      promptTemplate: 'template',
      sourceText: 'source',
    })).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_INVALID' });
  });

  it.each(['max_tokens', 'length'] as const)(
    'classifies chat completion %s as generation output truncation before parsing',
    async (finishReason) => {
      const provider = new OpenAiLlmProvider(
        new RecordingOpenAiClient('{', 'completed', finishReason),
        providerSettings('chat-completions'),
      );

      await expect(provider.generate({
        parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
        promptTemplate: 'template',
        sourceText: 'source',
      })).rejects.toMatchObject({ code: 'GENERATION_OUTPUT_TRUNCATED' });
    },
  );

  it.each([
    ['rate limit', new OpenAI.APIError(429, { message: 'provider overloaded' }, undefined, new Headers())],
    ['server failure', new OpenAI.APIError(503, { message: 'upstream error' }, undefined, new Headers())],
    ['connection failure', new OpenAI.APIConnectionError({ message: 'socket reset' })],
    ['timeout', new OpenAI.APIConnectionTimeoutError({ message: 'request timed out' })],
  ] satisfies readonly (readonly [string, Error])[])(
    'classifies transient %s as a safe provider failure',
    async (_kind, error) => {
      const provider = new OpenAiLlmProvider(
        new RejectingOpenAiClient(error),
        providerSettings('responses'),
      );

      const failure = await provider.generate({
        parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
        promptTemplate: 'template',
        sourceText: 'source',
      }).catch((caught: unknown) => caught);

      expect(failure).toMatchObject({
        code: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      });
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(error.message);
    },
  );

  it.each(['chat-completions', 'responses'] satisfies readonly LlmTransport[])(
    'classifies the credential-unavailable gateway 404 as a safe provider failure with %s',
    async (transport) => {
      const rawGatewayMessage = 'No active credentials for provider: minimax-cn';
      const provider = new OpenAiLlmProvider(
        new RejectingOpenAiClient(
          new OpenAI.NotFoundError(
            404,
            { message: rawGatewayMessage },
            undefined,
            new Headers(),
          ),
        ),
        providerSettings(transport),
      );

      const failure = await provider.generate({
        parameters: {
          format: 'mcq-single-select-v1',
          maxOutputTokens: 8000,
          questionsPerChunk: 1,
        },
        promptTemplate: 'template',
        sourceText: 'source',
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      });
      expect(String(failure)).not.toContain(rawGatewayMessage);
    },
  );

  it('does not classify an unrelated gateway 404 as provider unavailable', async () => {
    const provider = new OpenAiLlmProvider(
      new RejectingOpenAiClient(
        new OpenAI.NotFoundError(
          404,
          { message: 'Route was not found' },
          undefined,
          new Headers(),
        ),
      ),
      providerSettings('responses'),
    );

    await expect(provider.generate({
      parameters: {
        format: 'mcq-single-select-v1',
        maxOutputTokens: 8000,
        questionsPerChunk: 1,
      },
      promptTemplate: 'template',
      sourceText: 'source',
    })).rejects.toThrow('Route was not found');
  });

  it('does not classify an unknown provider 400 as provider unavailable', async () => {
    const provider = new OpenAiLlmProvider(
      new RejectingOpenAiClient(
        new OpenAI.APIError(400, { message: 'invalid provider request' }, undefined, new Headers()),
      ),
      providerSettings('responses'),
    );

    await expect(provider.generate({
      parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 8000, questionsPerChunk: 1 },
      promptTemplate: 'template',
      sourceText: 'source',
    })).rejects.toThrow('invalid provider request');
  });

  it('builds identity from endpoint capabilities but not the API key', () => {
    const base = {
      baseUrl: 'https://proxy.example.com/v1',
      capabilityVersion: 'responses-json-v1',
      model: 'proxy-model',
      structuredOutputMode: 'json-schema-strict' as const,
      transport: 'responses' as const,
    };

    expect(createOpenAiProviderIdentity(base)).toBe(createOpenAiProviderIdentity({ ...base }));
    expect(createOpenAiProviderIdentity(base)).not.toBe(createOpenAiProviderIdentity({
      ...base,
      transport: 'chat-completions',
    }));
    expect(createOpenAiProviderIdentity(base)).not.toBe(createOpenAiProviderIdentity({
      ...base,
      baseUrl: 'https://other.example.com/v1',
    }));
  });

  it('selects the configured provider without making an API request', () => {
    const fakeConfig = new ApplicationConfigService(new ConfigService({
      ai: { openai: { requestTimeoutMs: 60_000 }, provider: 'fake' },
      app: { env: 'development' },
    }));
    const openAiConfig = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'test-key',
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion: 'chat-completions-json-v1',
          model: 'gpt-test',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-object',
          transport: 'chat-completions',
        },
        provider: 'openai',
      },
      app: { env: 'production' },
    }));

    expect(createLlmProvider(fakeConfig)).toBeInstanceOf(FakeLlmProvider);
    expect(createLlmProvider(openAiConfig)).toBeInstanceOf(OpenAiLlmProvider);
  });

  it('fails fast for missing worker OpenAI credentials even when general ai config is readable', () => {
    const config = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion: 'chat-completions-json-v1',
          model: 'gpt-test',
          requestTimeoutMs: 60_000,
          structuredOutputMode: 'json-object',
          transport: 'chat-completions',
        },
        provider: 'openai',
      },
      app: { env: 'production' },
    }));

    expect(config.ai.provider).toBe('openai');
    expect(() => createLlmProvider(config)).toThrow(
      'OpenAI-compatible provider configuration is incomplete',
    );
  });
});

class RecordingOpenAiClient {
  readonly chatRequests: ChatCompletionCreateParamsNonStreaming[] = [];
  readonly responseRequests: ResponseCreateParamsNonStreaming[] = [];
  readonly chat = {
    completions: {
      create: async (
        request: ChatCompletionCreateParamsNonStreaming,
      ): Promise<{
        readonly choices: readonly {
          readonly finish_reason: string | null;
          readonly message: { readonly content: string | null };
        }[];
      }> => {
        this.chatRequests.push(request);
        return {
          choices: this.output === null ? [] : [{
            finish_reason: this.chatFinishReason,
            message: { content: this.output },
          }],
        };
      },
    },
  };
  readonly responses = {
    create: async (
      request: ResponseCreateParamsNonStreaming,
    ): Promise<Pick<Response, 'output_text' | 'status'>> => {
      this.responseRequests.push(request);
      return { output_text: this.output ?? '', status: this.responseStatus };
    },
  };

  constructor(
    private readonly output: string | null,
    private readonly responseStatus: Response['status'] = 'completed',
    private readonly chatFinishReason: 'length' | 'max_tokens' | 'stop' = 'stop',
  ) {}
}

class RejectingOpenAiClient {
  readonly chat = {
    completions: {
      create: async (
        _request: ChatCompletionCreateParamsNonStreaming,
      ): Promise<Pick<ChatCompletion, 'choices' | 'usage'>> => {
        throw this.error;
      },
    },
  };
  readonly responses = {
    create: async (
      _request: ResponseCreateParamsNonStreaming,
    ): Promise<Pick<Response, 'output_text' | 'status' | 'usage'>> => {
      throw this.error;
    },
  };

  constructor(private readonly error: Error) {}
}

function providerSettings(transport: LlmTransport): {
  readonly model: string;
  readonly providerIdentity: string;
  readonly structuredOutputMode: 'json-object';
  readonly transport: LlmTransport;
} {
  return {
    model: 'gpt-test',
    providerIdentity: 'provider-test',
    structuredOutputMode: 'json-object',
    transport,
  };
}
