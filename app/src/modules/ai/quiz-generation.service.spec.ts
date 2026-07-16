import { randomUUID } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import type {
  PersistedQuiz,
  QuizGenerationHandoff,
  QuizGenerationHandoffPort,
} from '../assessment/contracts/quiz-generation-handoff.contract';
import { Quiz } from '../assessment/domain/quiz';
import type { ChunkRecord } from './contracts/chunk.contracts';
import type {
  GenerationCache,
  GenerationCacheEntry,
} from './contracts/generation-cache.contracts';
import type {
  GeneratedQuestionOutput,
  JsonValue,
  LlmGenerationRequest,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import type { PromptVersionStore } from './contracts/prompt-version.contracts';
import { QuizGenerationService } from './quiz-generation.service';

describe('QuizGenerationService', () => {
  it('generates ordered chunks sequentially and hands off all grounded questions once', async () => {
    const provider = new RecordingProvider();
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const service = new QuizGenerationService(provider, cache, new RecordingPromptVersions(), handoff);
    const firstChunk = chunk(0, 'first source');
    const secondChunk = chunk(1, 'second source');

    await service.generate({
      chunks: [firstChunk, secondChunk],
      job: job(),
    });

    expect(provider.requests.map((request) => request.sourceText)).toEqual([
      firstChunk.text,
      secondChunk.text,
    ]);
    expect(provider.wasCalledConcurrently).toBe(false);
    expect(handoff.handoffs[0]?.questions.map((question) => question.citation.chunkId)).toEqual([
      firstChunk.id,
      secondChunk.id,
    ]);
    expect(handoff.handoffs[0]?.questions.map((question) => question.citation.snippet)).toEqual([
      firstChunk.text,
      secondChunk.text,
    ]);
    expect(handoff.handoffs).toHaveLength(1);
    expect(handoff.handoffs[0]?.questions).toHaveLength(2);
  });

  it('calls the provider only for cache misses and caches decoded output', async () => {
    const provider = new RecordingProvider();
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const service = new QuizGenerationService(provider, cache, new RecordingPromptVersions(), handoff);
    const input = { chunks: [chunk(0, 'first source'), chunk(1, 'second source')], job: job() };

    await service.generate(input);
    await service.generate(input);

    expect(provider.requests).toHaveLength(2);
    expect(cache.entries).toHaveLength(2);
    expect(cache.entries.every((entry) => entry.output.questions.length === 1)).toBe(true);
    expect(handoff.handoffs).toHaveLength(2);
  });

  it('rejects malformed provider output before it is cached or handed off', async () => {
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const provider = new RecordingProvider({ questions: [{ stem: 'missing required fields' }] });
    const service = new QuizGenerationService(provider, cache, new RecordingPromptVersions(), handoff);

    await expect(service.generate({ chunks: [chunk(0, 'source')], job: job() })).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });

    expect(cache.entries).toEqual([]);
    expect(handoff.handoffs).toEqual([]);
  });

  it('fails with the stable code when no valid question remains after aggregate validation', async () => {
    const invalidOutput: JsonValue = {
      questions: [{
        explanation: 'Two correct options violate the MCQ invariant.',
        options: [
          { content: 'one', isCorrect: true },
          { content: 'two', isCorrect: true },
        ],
        stem: 'Which option is correct?',
      }],
    };
    const service = new QuizGenerationService(
      new RecordingProvider(invalidOutput),
      new InMemoryGenerationCache(),
      new RecordingPromptVersions(),
      new RecordingHandoff(),
    );

    await expect(service.generate({ chunks: [chunk(0, 'source')], job: job() })).rejects.toMatchObject({
      code: 'INSUFFICIENT_VALID_QUESTIONS',
    });
  });
});

class RecordingProvider implements LlmProvider {
  readonly model = 'recording-model-v1';
  readonly providerIdentity = 'fake:recording-model-v1';
  readonly requests: LlmGenerationRequest[] = [];
  wasCalledConcurrently = false;
  private isGenerating = false;

  constructor(private readonly output?: JsonValue) {}

  async generate(request: LlmGenerationRequest): Promise<JsonValue> {
    if (this.isGenerating) this.wasCalledConcurrently = true;
    this.isGenerating = true;
    this.requests.push(request);
    await Promise.resolve();
    this.isGenerating = false;
    return this.output ?? validOutput(request.sourceText);
  }
}

class InMemoryGenerationCache implements GenerationCache {
  readonly entries: GenerationCacheEntry[] = [];

  async findDecodedOutput(cacheKey: string): Promise<GeneratedQuestionOutput | null> {
    return this.entries.find((entry) => entry.cacheKey === cacheKey)?.output ?? null;
  }

  async saveDecodedOutput(entry: GenerationCacheEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class RecordingPromptVersions implements PromptVersionStore {
  async record(): Promise<void> {}
}

class RecordingHandoff implements QuizGenerationHandoffPort {
  readonly handoffs: QuizGenerationHandoff[] = [];

  async persist(handoff: QuizGenerationHandoff): Promise<PersistedQuiz> {
    this.handoffs.push(handoff);
    const quiz = Quiz.create(handoff);
    return {
      optionCount: quiz.questions.reduce((count, question) => count + question.options.length, 0),
      questionCount: quiz.questions.length,
      questionIds: quiz.questions.map((question) => question.id),
      quizId: quiz.id,
    };
  }
}

function validOutput(sourceText: string): JsonValue {
  return {
    questions: [{
      explanation: `The source states: ${sourceText}`,
      options: [
        { content: sourceText, isCorrect: true },
        { content: 'An unsupported statement.', isCorrect: false },
      ],
      stem: `What does this source state: ${sourceText}?`,
    }],
  };
}

function chunk(chunkIndex: number, text: string): ChunkRecord {
  return {
    chunkIndex,
    contentHash: `${chunkIndex}`.padStart(64, '0'),
    id: randomUUID(),
    locator: { kind: 'page', page: chunkIndex + 1 },
    text,
  };
}

function job(): { readonly documentId: string; readonly ownerId: string } {
  return { documentId: randomUUID(), ownerId: randomUUID() };
}
