import { randomUUID } from 'crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  LlmGenerationResult,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import type { PromptVersionStore } from './contracts/prompt-version.contracts';
import { QuizGenerationService } from './quiz-generation.service';
import type { ProviderUsageStore } from './contracts/cost-guard.contracts';
import type { BudgetReservationPort } from '../content/contracts/budget-reservation.port';
import { ApplicationConfigService } from '../../config/application-config.service';
import type { ProcessingJobModelSelection } from './contracts/processing-job-model-selection.port';
import type { CustomModelProvider } from './contracts/custom-model-provider.port';
import {
  createGenerationCacheKey,
  QUIZ_GENERATION_PARAMETERS,
  QUIZ_GENERATION_PROMPT_TEMPLATE,
} from './quiz-generation.prompt';

describe('QuizGenerationService', () => {
  it('bounds concurrent generation and hands off sorted grounded questions once despite out-of-order completion', async () => {
    const provider = new OutOfOrderProvider();
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const service = new QuizGenerationService(
      provider,
      cache,
      new RecordingPromptVersions(),
      handoff,
      undefined,
      undefined,
      undefined,
      workerConfig(2),
    );
    const firstChunk = chunk(0, 'first source');
    const secondChunk = chunk(1, 'second source');
    const thirdChunk = chunk(2, 'third source');
    const processingJob = job();
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);

    const generation = service.generate({
      chunks: [thirdChunk, firstChunk, secondChunk],
      job: processingJob,
    });
    await provider.waitForStarted(2);
    provider.complete('second source');
    provider.complete('first source');
    await provider.waitForStarted(3);
    provider.complete('third source');
    await generation;

    expect(provider.maximumConcurrentCalls).toBe(2);
    expect(handoff.handoffs[0]?.questions.map((question) => question.citation.chunkId)).toEqual([
      firstChunk.id,
      secondChunk.id,
      thirdChunk.id,
    ]);
    expect(handoff.handoffs[0]?.questions.map((question) => question.citation.snippet)).toEqual([
      firstChunk.text,
      secondChunk.text,
      thirdChunk.text,
    ]);
    expect(handoff.handoffs[0]?.questions.map((question) => question.ordinal)).toEqual([0, 1, 2]);
    expect(handoff.handoffs).toHaveLength(1);
    expect(handoff.handoffs[0]?.questions).toHaveLength(3);
    const events = logger.mock.calls
      .map(([event]) => event)
      .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null && 'event' in event);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'ai.quiz_generation.cache_lookup.completed' }),
      expect.objectContaining({ event: 'ai.quiz_generation.provider_generation.completed' }),
      expect.objectContaining({ event: 'ai.quiz_generation.source_validation.completed' }),
      expect.objectContaining({ event: 'ai.quiz_generation.cache_persist.completed' }),
      expect.objectContaining({ event: 'ai.quiz_generation.handoff_persist.completed' }),
      expect.objectContaining({ event: 'ai.quiz_generation.total.completed' }),
    ]));
    for (const event of events) {
      expect(event).toEqual(expect.objectContaining({
        attempt: processingJob.attempt,
        correlationId: processingJob.correlationId,
        durationMs: expect.any(Number),
        jobId: processingJob.id,
      }));
      expect(Object.keys(event)).not.toEqual(expect.arrayContaining([
        'cacheKey',
        'citation',
        'output',
        'prompt',
        'source',
        'text',
      ]));
    }
    logger.mockRestore();
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

  it('rejects fresh copied-English output before it is cached or handed off', async () => {
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const sourceText = [
      'The deployment controller uses this signal to avoid routing traffic too early.',
      'The readiness endpoint should respond quickly even during partial startup delays.',
    ].join(' ');
    const provider = new RecordingProvider({
      questions: [
        {
          explanation: 'Giải thích bằng tiếng Việt về readinessProbe và livenessProbe.',
          options: [
            { content: 'Cụm probe giúp kiểm tra trạng thái Pod.', isCorrect: true },
            { content: 'Probe dùng để tăng số replica tự động.', isCorrect: false },
          ],
          stem: 'The deployment controller uses this signal to avoid routing traffic too early.',
        },
      ],
    });
    const service = new QuizGenerationService(provider, cache, new RecordingPromptVersions(), handoff);

    await expect(service.generate({ chunks: [chunk(0, sourceText)], job: job() })).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });

    expect(provider.requests).toHaveLength(1);
    expect(cache.entries).toEqual([]);
    expect(handoff.handoffs).toEqual([]);
  });

  it('rejects invalid cached output without calling the provider or handing off a quiz', async () => {
    const provider = new RecordingProvider();
    const cache = new InMemoryGenerationCache();
    const handoff = new RecordingHandoff();
    const service = new QuizGenerationService(provider, cache, new RecordingPromptVersions(), handoff);
    const sourceText = [
      'Operators use this mechanism to recover a stuck container automatically.',
      'A liveness failure should trigger a restart after repeated unsuccessful health checks.',
    ].join(' ');
    const cachedChunk = chunk(0, sourceText);
    await cache.seedDecodedOutput(provider.providerIdentity, cachedChunk.text, {
      questions: [
        {
          explanation: 'Giải thích bằng tiếng Việt về cơ chế tự phục hồi của Pod.',
          options: [
            {
              content: 'Operators use this mechanism to recover a stuck container automatically.',
              isCorrect: true,
            },
            { content: 'Pod luôn bị xóa ngay khi probe chạy.', isCorrect: false },
          ],
          stem: 'Nội dung nào mô tả đúng tác dụng của liveness check?',
        },
      ],
    });

    await expect(service.generate({ chunks: [cachedChunk], job: job() })).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });

    expect(provider.requests).toEqual([]);
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

  it('settles durable known usage when a later chunk fails after an earlier provider call', async () => {
    const costs = new RecordingCostGuard({ hasUncertainDispatch: false, knownActualCredits: 15 });
    const provider = new FailingSecondProvider();
    const service = new QuizGenerationService(provider, new InMemoryGenerationCache(), new RecordingPromptVersions(), new RecordingHandoff(), costs, costs);

    await expect(service.generate({ chunks: [chunk(0, 'first'), chunk(1, 'second')], job: job() })).rejects.toThrow('provider failed');

    expect(costs.recordedUsage).toHaveLength(3);
    expect(costs.recordedUsage.filter((record) => record.chargedCredits === null)).toHaveLength(2);
    expect(costs.settlements).toEqual([expect.objectContaining({ hasUncertainDispatch: false, knownActualCredits: 15 })]);
  });

  it('stops assigning chunks after a failure and settles only after started provider work finishes', async () => {
    const costs = new RecordingCostGuard({ hasUncertainDispatch: true, knownActualCredits: 0 });
    const provider = new GatedFailureProvider();
    const service = new QuizGenerationService(
      provider,
      new InMemoryGenerationCache(),
      new RecordingPromptVersions(),
      new RecordingHandoff(),
      costs,
      costs,
      undefined,
      workerConfig(2),
    );

    const generation = service.generate({
      chunks: [chunk(0, 'first'), chunk(1, 'second'), chunk(2, 'third')],
      job: job(),
    });
    await provider.waitForStarted(2);
    provider.failFirst();
    await Promise.resolve();

    expect(provider.requests).toHaveLength(2);
    expect(costs.settlements).toEqual([]);

    provider.completeSecond();

    await expect(generation).rejects.toThrow('provider failed');
    expect(provider.requests).toHaveLength(2);
    expect(costs.settlements).toEqual([expect.objectContaining({ hasUncertainDispatch: true })]);
  });

  it('keeps an uncertain dispatched request held after the provider throws without usage', async () => {
    const costs = new RecordingCostGuard({ hasUncertainDispatch: true, knownActualCredits: 0 });
    const provider = new ThrowingProvider();
    const service = new QuizGenerationService(provider, new InMemoryGenerationCache(), new RecordingPromptVersions(), new RecordingHandoff(), costs, costs);

    await expect(service.generate({ chunks: [chunk(0, 'source')], job: job() })).rejects.toThrow('provider failed');

    expect(costs.recordedUsage).toEqual([expect.objectContaining({ cached: false, chargedCredits: null, usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' } })]);
    expect(costs.settlements).toEqual([expect.objectContaining({ hasUncertainDispatch: true, knownActualCredits: 0 })]);
  });

  it('records custom provider usage without reserving or settling platform credits', async () => {
    const costs = new RecordingCostGuard({ hasUncertainDispatch: false, knownActualCredits: 0 });
    const provider = new RecordingProvider();
    const customProviders: CustomModelProvider = {
      resolve: async (): Promise<LlmProvider> => provider,
    };
    const service = new QuizGenerationService(
      provider,
      new InMemoryGenerationCache(),
      new RecordingPromptVersions(),
      new RecordingHandoff(),
      costs,
      costs,
      customProviders,
    );

    await service.generate({
      chunks: [chunk(0, 'source')],
      job: {
        ...job(),
        selection: {
          customModelConfigId: randomUUID(),
          kind: 'CUSTOM',
          platformModelId: null,
        },
      },
    });

    expect(costs.recordedUsage).toEqual([
      expect.objectContaining({ chargedCredits: null }),
      expect.objectContaining({ chargedCredits: 0 }),
    ]);
    expect(costs.reservations).toEqual([]);
    expect(costs.settlements).toEqual([]);
  });

  it('reserves platform budget using the shared output-token cap for every chunk', async () => {
    const costs = new RecordingCostGuard({ hasUncertainDispatch: false, knownActualCredits: 0 });
    const provider = new RecordingProvider();
    const service = new QuizGenerationService(
      provider,
      new InMemoryGenerationCache(),
      new RecordingPromptVersions(),
      new RecordingHandoff(),
      costs,
      costs,
    );
    const chunks = [chunk(0, 'first source'), chunk(1, 'second source'), chunk(2, 'third source')];

    await service.generate({ chunks, job: job() });

    expect(QUIZ_GENERATION_PARAMETERS.maxOutputTokens).toBe(8000);
    expect(costs.reservations).toEqual([
      expect.objectContaining({
        estimatedCredits: chunks.length * QUIZ_GENERATION_PARAMETERS.maxOutputTokens,
      }),
    ]);
    expect(provider.requests).toHaveLength(chunks.length);
    expect(costs.settlements).toHaveLength(1);
  });

  it('persists the configured default platform model before a legacy job calls a provider', async () => {
    const selections: ProcessingJobModelSelection = { ensureDefaultPlatformModel: jest.fn(async () => true) };
    const config = new ApplicationConfigService(new ConfigService({
      ai: { openai: { requestTimeoutMs: 60_000 }, platformModels: [{ creditPerInputToken: 1, creditPerOutputToken: 2, id: 'configured-default', model: 'test', planIds: ['free'] }], provider: 'fake' },
      app: { env: 'development' },
      worker: workerSettings(8),
    }));
    const provider = new RecordingProvider();
    const service = new QuizGenerationService(provider, new InMemoryGenerationCache(), new RecordingPromptVersions(), new RecordingHandoff(), undefined, undefined, undefined, config, selections);
    const legacyJob = { ...job(), selection: undefined };

    await service.generate({ chunks: [chunk(0, 'source')], job: legacyJob });

    expect(selections.ensureDefaultPlatformModel).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'configured-default' }));
    expect(provider.requests).toHaveLength(1);
  });
});

class RecordingProvider implements LlmProvider {
  readonly model = 'recording-model-v1';
  readonly providerIdentity = 'fake:recording-model-v1';
  readonly requests: LlmGenerationRequest[] = [];
  wasCalledConcurrently = false;
  private isGenerating = false;

  constructor(private readonly output?: JsonValue) {}

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    if (this.isGenerating) this.wasCalledConcurrently = true;
    this.isGenerating = true;
    this.requests.push(request);
    await Promise.resolve();
    this.isGenerating = false;
    return {
      output: this.output ?? validOutput(request.sourceText),
      usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' },
    };
  }
}

class FailingSecondProvider extends RecordingProvider {
  private callCount = 0;

  override async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.callCount += 1;
    if (this.callCount === 2) throw new Error('provider failed');
    return super.generate(request);
  }
}

class ThrowingProvider extends RecordingProvider {
  override async generate(_request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    throw new Error('provider failed');
  }
}

class OutOfOrderProvider implements LlmProvider {
  readonly model = 'out-of-order-model-v1';
  readonly providerIdentity = 'fake:out-of-order-model-v1';
  readonly requests: LlmGenerationRequest[] = [];
  maximumConcurrentCalls = 0;
  private activeCalls = 0;
  private readonly completions = new Map<string, () => void>();

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.requests.push(request);
    this.activeCalls += 1;
    this.maximumConcurrentCalls = Math.max(this.maximumConcurrentCalls, this.activeCalls);
    await new Promise<void>((resolve) => this.completions.set(request.sourceText, resolve));
    this.activeCalls -= 1;
    return {
      output: validOutput(request.sourceText),
      usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' },
    };
  }

  complete(sourceText: string): void {
    const completion = this.completions.get(sourceText);
    if (!completion) throw new Error('Provider request was not started');
    completion();
  }

  async waitForStarted(count: number): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (this.requests.length >= count) return;
      await Promise.resolve();
    }
    throw new Error(`Expected ${count} provider requests to start`);
  }
}

class GatedFailureProvider implements LlmProvider {
  readonly model = 'gated-failure-model-v1';
  readonly providerIdentity = 'fake:gated-failure-model-v1';
  readonly requests: LlmGenerationRequest[] = [];
  private rejectFirstRequest: ((reason?: unknown) => void) | undefined;
  private resolveSecondRequest: (() => void) | undefined;

  async generate(request: LlmGenerationRequest): Promise<LlmGenerationResult> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      await new Promise<void>((_resolve, reject) => { this.rejectFirstRequest = reject; });
      throw new Error('Provider failure must reject');
    }
    await new Promise<void>((resolve) => { this.resolveSecondRequest = resolve; });
    return {
      output: validOutput(request.sourceText),
      usage: { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' },
    };
  }

  failFirst(): void {
    if (!this.rejectFirstRequest) throw new Error('First provider request was not started');
    this.rejectFirstRequest(new Error('provider failed'));
  }

  completeSecond(): void {
    if (!this.resolveSecondRequest) throw new Error('Second provider request was not started');
    this.resolveSecondRequest();
  }

  async waitForStarted(count: number): Promise<void> {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (this.requests.length >= count) return;
      await Promise.resolve();
    }
    throw new Error(`Expected ${count} provider requests to start`);
  }
}

class RecordingCostGuard implements ProviderUsageStore, BudgetReservationPort {
  readonly recordedUsage: Parameters<ProviderUsageStore['recordUsage']>[0][] = [];
  readonly reservations: Parameters<BudgetReservationPort['reserve']>[0][] = [];
  readonly settlements: Parameters<BudgetReservationPort['settle']>[0][] = [];

  constructor(private readonly summary: Awaited<ReturnType<ProviderUsageStore['summarizeUsage']>>) {}

  async reserve(input: Parameters<BudgetReservationPort['reserve']>[0]): Promise<void> {
    this.reservations.push(input);
  }

  async recordUsage(input: Parameters<ProviderUsageStore['recordUsage']>[0]): Promise<void> {
    this.recordedUsage.push(input);
  }

  async settle(input: Parameters<BudgetReservationPort['settle']>[0]): Promise<void> {
    this.settlements.push(input);
  }

  async summarizeUsage(): Promise<Awaited<ReturnType<ProviderUsageStore['summarizeUsage']>>> {
    return this.summary;
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

  async seedDecodedOutput(
    providerIdentity: string,
    sourceText: string,
    output: GeneratedQuestionOutput,
  ): Promise<void> {
    this.entries.push({
      cacheKey: createGenerationCacheKey({
        params: QUIZ_GENERATION_PARAMETERS,
        providerIdentity,
        sourceText,
        template: QUIZ_GENERATION_PROMPT_TEMPLATE,
      }),
      model: 'seeded-model-v1',
      output,
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptFingerprint: 'seeded-prompt-fingerprint',
    });
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
      explanation: `Giải thích bằng tiếng Việt: đoạn tư liệu mô tả ý chính của chủ đề ${summarizeSource(sourceText)}.`,
      options: [
        { content: `Nhận định đúng về chủ đề ${summarizeSource(sourceText)}.`, isCorrect: true },
        { content: 'Một nhận định không được tư liệu hỗ trợ.', isCorrect: false },
      ],
      stem: `Phát biểu nào đúng về nội dung ${summarizeSource(sourceText)}?`,
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

function summarizeSource(sourceText: string): string {
  return sourceText.split(/\s+/u).slice(0, 3).join(' ');
}

function job(): {
  readonly attempt: number;
  readonly correlationId: string;
  readonly documentId: string;
  readonly id: string;
  readonly leaseId: string;
  readonly ownerId: string;
  readonly selection: { readonly customModelConfigId: null; readonly kind: 'PLAN'; readonly platformModelId: 'platform-default' };
} {
  return {
    attempt: 1,
    correlationId: randomUUID(),
    documentId: randomUUID(),
    id: randomUUID(),
    leaseId: randomUUID(),
    ownerId: randomUUID(),
    selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'platform-default' },
  };
}

function workerConfig(quizGenerationConcurrency: number): ApplicationConfigService {
  return new ApplicationConfigService(new ConfigService({
    worker: workerSettings(quizGenerationConcurrency),
  }));
}

function workerSettings(quizGenerationConcurrency: number): Record<string, number | string> {
  return {
    chunkInsertBatchSize: 500,
    chunkMaxChars: 1_500,
    chunkOverlapChars: 150,
    chunkTargetChars: 1_200,
    errorBackoffMs: 5_000,
    executionMode: 'legacy-processing',
    healthHost: '0.0.0.0',
    healthPort: 3_403,
    jobBatchSize: 10,
    maxChunksPerDocument: 20_000,
    maxChunkTotalChars: 24_000_000,
    maxExtractableObjectBytes: 20_971_520,
    outboxBatchSize: 100,
    pollIntervalMs: 1_000,
    quizGenerationConcurrency,
    stuckJobBatchSize: 100,
    stuckJobTimeoutMs: 300_000,
  };
}
