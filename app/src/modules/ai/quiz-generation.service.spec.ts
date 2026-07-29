import { randomUUID } from 'crypto';

import { describe, expect, it, jest } from '@jest/globals';
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
    expect(handoff.handoffs[0]?.questions.map((question) => question.ordinal)).toEqual([0, 1]);
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

  it('persists the configured default platform model before a legacy job calls a provider', async () => {
    const selections: ProcessingJobModelSelection = { ensureDefaultPlatformModel: jest.fn(async () => true) };
    const config = new ApplicationConfigService(new ConfigService({
      ai: { openai: { requestTimeoutMs: 60_000 }, platformModels: [{ creditPerInputToken: 1, creditPerOutputToken: 2, id: 'configured-default', model: 'test', planIds: ['free'] }], provider: 'fake' },
      app: { env: 'development' },
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
  readonly documentId: string;
  readonly id: string;
  readonly ownerId: string;
  readonly selection: { readonly customModelConfigId: null; readonly kind: 'PLAN'; readonly platformModelId: 'platform-default' };
} {
  return {
    attempt: 1,
    documentId: randomUUID(),
    id: randomUUID(),
    ownerId: randomUUID(),
    selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'platform-default' },
  };
}
