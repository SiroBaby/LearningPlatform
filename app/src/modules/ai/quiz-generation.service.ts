import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  QUIZ_GENERATION_HANDOFF,
  type QuestionCandidate,
  type QuizGenerationHandoffPort,
} from '../assessment/contracts/quiz-generation-handoff.contract';
import { AssessmentError, AssessmentErrorCode } from '../assessment/domain/assessment.error';
import { ApplicationConfigService } from '../../config/application-config.service';

import type { ChunkRecord } from './contracts/chunk.contracts';
import {
  GENERATION_CACHE,
  type GenerationCache,
} from './contracts/generation-cache.contracts';
import type {
  GeneratedQuestionOutput,
  LlmProvider,
} from './contracts/llm-provider.contracts';
import { LLM_PROVIDER } from './contracts/llm-provider.contracts';
import { PROVIDER_USAGE, type ProviderUsageStore } from './contracts/cost-guard.contracts';
import { BUDGET_RESERVATION, type BudgetReservationPort } from '../content/contracts/budget-reservation.port';
import { CUSTOM_MODEL_PROVIDER, type CustomModelProvider } from './contracts/custom-model-provider.port';
import { PROCESSING_JOB_MODEL_SELECTION, type ProcessingJobModelSelection } from './contracts/processing-job-model-selection.port';
import { PROCESSING_JOB_BUDGET, type ProcessingJobBudget } from './contracts/processing-job-budget.port';
import type { ProviderUsage } from './contracts/cost-guard.contracts';
import {
  PROMPT_VERSION_STORE,
  type PromptVersionStore,
} from './contracts/prompt-version.contracts';
import type { GenerateQuizCommand, QuizGenerator } from './contracts/quiz-generator.port';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';
import { validateGeneratedQuestionOutputAgainstSource } from './quiz-generation-output.source-validation';
import {
  createGenerationCacheKey,
  createPromptFingerprint,
  QUIZ_GENERATION_PARAMETERS,
  QUIZ_GENERATION_PROMPT_TEMPLATE,
} from './quiz-generation.prompt';

const MINIMUM_VALID_QUESTIONS = 1;

@Injectable()
export class QuizGenerationService implements QuizGenerator {
  constructor(
    @Optional() @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | undefined,
    @Inject(GENERATION_CACHE) private readonly cache: GenerationCache,
    @Inject(PROMPT_VERSION_STORE) private readonly promptVersions: PromptVersionStore,
    @Inject(QUIZ_GENERATION_HANDOFF) private readonly handoff: QuizGenerationHandoffPort,
    @Optional() @Inject(PROVIDER_USAGE) private readonly usage?: ProviderUsageStore,
    @Optional() @Inject(BUDGET_RESERVATION) private readonly budgetReservations?: BudgetReservationPort,
    @Optional() @Inject(CUSTOM_MODEL_PROVIDER) private readonly customProviders?: CustomModelProvider,
    @Optional() private readonly config?: ApplicationConfigService,
    @Optional() @Inject(PROCESSING_JOB_MODEL_SELECTION) private readonly jobSelections?: ProcessingJobModelSelection,
    @Optional() @Inject(PROCESSING_JOB_BUDGET) private readonly jobBudget?: ProcessingJobBudget,
  ) {}

  async generate(command: GenerateQuizCommand): Promise<void> {
    const resolvedCommand = await this.resolveDefaultPlatformModel(command);
    const provider = await this.resolveProvider(resolvedCommand);
    if (!provider) {
      throw new Error('LLM provider is unavailable outside the worker runtime');
    }
    const platform = resolvedCommand.job.selection?.kind !== 'CUSTOM';
    const estimatedCredits = this.estimateCredits(resolvedCommand.chunks.length, platform);
    const budget = this.resolveBudget(resolvedCommand, estimatedCredits, platform);
    if (budget && platform) await this.budgetReservations?.reserve(budget);
    try {
      const promptVersion = createPromptFingerprint({
        params: QUIZ_GENERATION_PARAMETERS,
        providerIdentity: provider.providerIdentity,
        template: QUIZ_GENERATION_PROMPT_TEMPLATE,
      });
      await this.promptVersions.record({
        fingerprint: promptVersion,
        model: provider.model,
        parameters: QUIZ_GENERATION_PARAMETERS,
        template: QUIZ_GENERATION_PROMPT_TEMPLATE,
      });
      const questions: QuestionCandidate[] = [];
      const orderedChunks = [...resolvedCommand.chunks].sort(
        (left, right) => left.chunkIndex - right.chunkIndex,
      );
      for (const chunk of orderedChunks) {
        const generated = await this.generateForChunk(chunk, promptVersion, provider, resolvedCommand.job, platform);
        this.appendQuestions(questions, chunk, generated.output);
      }
      await this.handoff.persist({
        documentId: resolvedCommand.job.documentId,
        minimumQuestionCount: MINIMUM_VALID_QUESTIONS,
        ownerId: resolvedCommand.job.ownerId,
        promptVersion,
        questions,
      });
      await this.settleBudget(budget);
    } catch (error) {
      await this.settleBudget(budget);
      if (
        error instanceof AssessmentError &&
        error.code === AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS
      ) {
        throw new QuizGenerationError(QuizGenerationErrorCode.INSUFFICIENT_VALID_QUESTIONS);
      }
      throw error;
    }
  }

  private async resolveProvider(command: GenerateQuizCommand): Promise<LlmProvider> {
    if (command.job.selection?.kind === 'CUSTOM') {
      if (!this.customProviders || !command.job.selection.customModelConfigId) {
        throw new Error('Custom model provider is unavailable outside the worker runtime');
      }
      return this.customProviders.resolve(command.job.ownerId, command.job.selection.customModelConfigId);
    }
    if (!this.provider) throw new Error('LLM provider is unavailable outside the worker runtime');
    return this.provider;
  }

  private async resolveDefaultPlatformModel(command: GenerateQuizCommand): Promise<GenerateQuizCommand> {
    if (command.job.selection) return command;
    const modelId = this.config?.ai.platformModels[0]?.id;
    if (!modelId || !this.jobSelections || command.job.id === undefined || command.job.attempt === undefined) {
      throw new Error('Processing job has no model selection');
    }
    const persisted = await this.jobSelections.ensureDefaultPlatformModel({
      attempt: command.job.attempt,
      jobId: command.job.id,
      modelId,
      ownerId: command.job.ownerId,
    });
    if (!persisted) throw new Error('Processing job model selection could not be fenced');
    return {
      chunks: command.chunks,
      job: {
        ...command.job,
        selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: modelId },
      },
    };
  }

  private async generateForChunk(
    chunk: ChunkRecord,
    promptFingerprint: string,
    provider: LlmProvider,
    job: GenerateQuizCommand['job'],
    platform: boolean,
  ): Promise<{ readonly credits: number; readonly output: GeneratedQuestionOutput; readonly usageAvailable: boolean }> {
    const cacheKey = createGenerationCacheKey({
      params: QUIZ_GENERATION_PARAMETERS,
      providerIdentity: provider.providerIdentity,
      sourceText: chunk.text,
      template: QUIZ_GENERATION_PROMPT_TEMPLATE,
    });
    const cached = await this.cache.findDecodedOutput(cacheKey);
    if (cached) {
      validateGeneratedQuestionOutputAgainstSource(chunk.text, cached);
      const usageRecord = this.resolveUsageRecord(job, cacheKey, provider.providerIdentity, true, unavailableUsage(), 0);
      if (usageRecord) await this.usage?.recordUsage(usageRecord);
      return { credits: 0, output: cached, usageAvailable: true };
    }
    const dispatched = this.resolveUsageRecord(job, cacheKey, provider.providerIdentity, false, unavailableUsage(), null);
    if (dispatched) await this.usage?.recordUsage(dispatched);
    const generated = await provider.generate({
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptTemplate: QUIZ_GENERATION_PROMPT_TEMPLATE,
      sourceText: chunk.text,
    });
    const usageRecord = this.resolveUsageRecord(job, cacheKey, provider.providerIdentity, false, generated.usage, platform ? this.creditsForUsage(job, generated.usage) : 0);
    if (usageRecord) await this.usage?.recordUsage(usageRecord);
    const output = decodeGeneratedQuestionOutput(generated.output);
    validateGeneratedQuestionOutputAgainstSource(chunk.text, output);
    await this.cache.saveDecodedOutput({
      cacheKey,
      model: provider.model,
      output,
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptFingerprint,
    });
    return {
      credits: platform ? this.creditsForUsage(job, generated.usage) : 0,
      output,
      usageAvailable: generated.usage.status === 'AVAILABLE',
    };
  }

  private estimateCredits(chunkCount: number, platform: boolean): number {
    return platform ? chunkCount * QUIZ_GENERATION_PARAMETERS.maxOutputTokens : 0;
  }

  private creditsForUsage(job: GenerateQuizCommand['job'], usage: ProviderUsage): number {
    if (
      usage.status !== 'AVAILABLE' ||
      usage.inputTokens === null ||
      usage.outputTokens === null ||
      !job.selection?.platformModelId ||
      !this.config
    ) return 0;
    const model = this.config.ai.platformModels.find((candidate) => candidate.id === job.selection?.platformModelId);
    if (!model) return 0;
    return usage.inputTokens * model.creditPerInputToken + usage.outputTokens * model.creditPerOutputToken;
  }

  private resolveBudget(
    command: GenerateQuizCommand,
    estimatedCredits: number,
    platform: boolean,
  ): { readonly attempt: number; readonly estimatedCredits: number; readonly jobId: string; readonly ownerId: string; readonly platform: boolean } | null {
    if (command.job.attempt === undefined || command.job.id === undefined) return null;
    return { attempt: command.job.attempt, estimatedCredits, jobId: command.job.id, ownerId: command.job.ownerId, platform };
  }

  private resolveUsageRecord(
    job: GenerateQuizCommand['job'],
    cacheKey: string,
    providerIdentity: string,
    cached: boolean,
    usage: ProviderUsage,
    chargedCredits: number | null,
  ): { readonly attempt: number; readonly cached: boolean; readonly chargedCredits: number | null; readonly jobId: string; readonly ownerId: string; readonly providerIdentity: string; readonly requestKey: string; readonly usage: ProviderUsage } | null {
    if (job.attempt === undefined || job.id === undefined) return null;
    return { attempt: job.attempt, cached, chargedCredits, jobId: job.id, ownerId: job.ownerId, providerIdentity, requestKey: `${job.id}:${job.attempt}:${cacheKey}`, usage };
  }

  private async settleBudget(
    budget: { readonly attempt: number; readonly estimatedCredits: number; readonly jobId: string; readonly ownerId: string; readonly platform: boolean } | null,
  ): Promise<void> {
    if (!budget || !budget.platform || !this.usage || !this.budgetReservations) return;
    const summary = await this.usage.summarizeUsage({
      attempt: budget.attempt,
      jobId: budget.jobId,
      ownerId: budget.ownerId,
    });
    await this.budgetReservations.settle({
      attempt: budget.attempt,
      hasUncertainDispatch: summary.hasUncertainDispatch,
      jobId: budget.jobId,
      knownActualCredits: summary.knownActualCredits,
      ownerId: budget.ownerId,
    });
    await this.jobBudget?.record({
      attempt: budget.attempt,
      budgetStatus: summary.hasUncertainDispatch ? 'HELD' : 'SETTLED',
      estimatedCredits: budget.estimatedCredits,
      jobId: budget.jobId,
      settledCredits: summary.knownActualCredits,
    });
  }

  private appendQuestions(
    accumulated: QuestionCandidate[],
    chunk: ChunkRecord,
    generated: GeneratedQuestionOutput,
  ): void {
    for (const question of generated.questions) {
      accumulated.push({
        citation: { chunkId: chunk.id, locator: chunk.locator, snippet: chunk.text },
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        explanation: question.explanation,
        options: question.options,
        ordinal: accumulated.length,
        stem: question.stem,
      });
    }
  }
}

function unavailableUsage(): ProviderUsage {
  return { inputTokens: null, outputTokens: null, status: 'UNAVAILABLE' };
}
