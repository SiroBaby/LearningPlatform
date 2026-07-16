import { Inject, Injectable, Optional } from '@nestjs/common';

import {
  QUIZ_GENERATION_HANDOFF,
  type QuestionCandidate,
  type QuizGenerationHandoffPort,
} from '../assessment/contracts/quiz-generation-handoff.contract';
import { AssessmentError, AssessmentErrorCode } from '../assessment/domain/assessment.error';

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
import {
  PROMPT_VERSION_STORE,
  type PromptVersionStore,
} from './contracts/prompt-version.contracts';
import type { GenerateQuizCommand, QuizGenerator } from './contracts/quiz-generator.port';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';
import { decodeGeneratedQuestionOutput } from './quiz-generation-output.decoder';
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
  ) {}

  async generate(command: GenerateQuizCommand): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      throw new Error('LLM provider is unavailable outside the worker runtime');
    }
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
    const orderedChunks = [...command.chunks].sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    for (const chunk of orderedChunks) {
      const generated = await this.generateForChunk(chunk, promptVersion, provider);
      this.appendQuestions(questions, chunk, generated);
    }
    try {
      await this.handoff.persist({
        documentId: command.job.documentId,
        minimumQuestionCount: MINIMUM_VALID_QUESTIONS,
        ownerId: command.job.ownerId,
        promptVersion,
        questions,
      });
    } catch (error) {
      if (
        error instanceof AssessmentError &&
        error.code === AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS
      ) {
        throw new QuizGenerationError(QuizGenerationErrorCode.INSUFFICIENT_VALID_QUESTIONS);
      }
      throw error;
    }
  }

  private async generateForChunk(
    chunk: ChunkRecord,
    promptFingerprint: string,
    provider: LlmProvider,
  ): Promise<GeneratedQuestionOutput> {
    const cacheKey = createGenerationCacheKey({
      params: QUIZ_GENERATION_PARAMETERS,
      providerIdentity: provider.providerIdentity,
      sourceText: chunk.text,
      template: QUIZ_GENERATION_PROMPT_TEMPLATE,
    });
    const cached = await this.cache.findDecodedOutput(cacheKey);
    if (cached) return cached;
    const rawOutput = await provider.generate({
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptTemplate: QUIZ_GENERATION_PROMPT_TEMPLATE,
      sourceText: chunk.text,
    });
    const output = decodeGeneratedQuestionOutput(rawOutput);
    await this.cache.saveDecodedOutput({
      cacheKey,
      model: provider.model,
      output,
      parameters: QUIZ_GENERATION_PARAMETERS,
      promptFingerprint,
    });
    return output;
  }

  private appendQuestions(
    accumulated: QuestionCandidate[],
    chunk: ChunkRecord,
    generated: GeneratedQuestionOutput,
  ): void {
    for (const [ordinal, question] of generated.questions.entries()) {
      accumulated.push({
        citation: { chunkId: chunk.id, locator: chunk.locator, snippet: chunk.text },
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        explanation: question.explanation,
        options: question.options,
        ordinal,
        stem: question.stem,
      });
    }
  }
}
