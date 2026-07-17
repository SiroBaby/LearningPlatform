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

import { ApplicationConfigService } from '../../config/application-config.service';
import type {
  LlmStructuredOutputMode,
  LlmTransport,
} from '../../config/configuration.types';
import { FakeLlmProvider } from './fake-llm-provider';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';
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
          maxOutputTokens: 1000,
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
          max_output_tokens: 1000,
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
        max_tokens: 1000,
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

  it('maps incomplete, missing, or non-JSON output to a safe generation error', async () => {
    const request = {
      parameters: {
        format: 'mcq-single-select-v1' as const,
        maxOutputTokens: 1000 as const,
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

  it('builds identity from endpoint capabilities but not the API key', () => {
    const base = {
      baseUrl: 'https://proxy.example.com/v1',
      capabilityVersion: 'v1',
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
          capabilityVersion: 'v1',
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
});

class RecordingOpenAiClient {
  readonly chatRequests: ChatCompletionCreateParamsNonStreaming[] = [];
  readonly responseRequests: ResponseCreateParamsNonStreaming[] = [];
  readonly chat = {
    completions: {
      create: async (
        request: ChatCompletionCreateParamsNonStreaming,
      ): Promise<Pick<ChatCompletion, 'choices'>> => {
        this.chatRequests.push(request);
        return {
          choices: this.output === null ? [] : [{
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
            message: { content: this.output, refusal: null, role: 'assistant' },
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
  ) {}
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
