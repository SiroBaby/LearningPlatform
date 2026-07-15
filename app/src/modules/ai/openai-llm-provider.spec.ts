import { describe, expect, it } from '@jest/globals';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';
import { ConfigService } from '@nestjs/config';

import { ApplicationConfigService } from '../../config/application-config.service';
import { FakeLlmProvider } from './fake-llm-provider';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';
import { createLlmProvider, OpenAiLlmProvider } from './openai-llm-provider';

describe('OpenAiLlmProvider', () => {
  it('requests a non-stored strict structured response for one source chunk', async () => {
    const client = new RecordingOpenAiClient(completedResponse(JSON.stringify({
      questions: [{
        explanation: 'Grounded explanation',
        options: [
          { content: 'Correct', isCorrect: true },
          { content: 'Incorrect', isCorrect: false },
        ],
        stem: 'What is supported?',
      }],
    })));
    const provider = new OpenAiLlmProvider(client, 'gpt-test');

    const output = await provider.generate({
      parameters: {
        format: 'mcq-single-select-v1',
        maxOutputTokens: 1000,
        questionsPerChunk: 1,
      },
      promptTemplate: 'Use only the supplied source.',
      sourceText: 'One grounded chunk.',
    });

    expect(decodeGeneratedQuestionOutput(output).questions).toHaveLength(1);
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      input: 'One grounded chunk.',
      instructions: 'Use only the supplied source.',
      max_output_tokens: 1000,
      model: 'gpt-test',
      store: false,
      text: { format: { name: 'quiz_questions', strict: true, type: 'json_schema' } },
    });
  });

  it('maps incomplete or non-JSON output to a safe generation error', async () => {
    const incomplete = new OpenAiLlmProvider(
      new RecordingOpenAiClient(completedResponse('', 'incomplete')),
      'gpt-test',
    );
    const invalidJson = new OpenAiLlmProvider(
      new RecordingOpenAiClient(completedResponse('not-json')),
      'gpt-test',
    );
    const request = {
      parameters: {
        format: 'mcq-single-select-v1' as const,
        maxOutputTokens: 1000 as const,
        questionsPerChunk: 1 as const,
      },
      promptTemplate: 'template',
      sourceText: 'source',
    };

    await expect(incomplete.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
    await expect(invalidJson.generate(request)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
  });

  it('selects the configured provider without making an API request', () => {
    const fakeConfig = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: { requestTimeoutMs: 60_000 },
        provider: 'fake',
      },
      app: { env: 'development' },
    }));
    const openAiConfig = new ApplicationConfigService(new ConfigService({
      ai: {
        openai: {
          apiKey: 'test-key',
          model: 'gpt-test',
          requestTimeoutMs: 60_000,
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
  readonly requests: ResponseCreateParamsNonStreaming[] = [];
  readonly responses = {
    create: async (
      request: ResponseCreateParamsNonStreaming,
    ): Promise<Pick<Response, 'output_text' | 'status'>> => {
      this.requests.push(request);
      return this.response;
    },
  };

  constructor(
    private readonly response: Pick<Response, 'output_text' | 'status'>,
  ) {}
}

function completedResponse(
  outputText: string,
  status: Response['status'] = 'completed',
): Pick<Response, 'output_text' | 'status'> {
  return { output_text: outputText, status };
}
