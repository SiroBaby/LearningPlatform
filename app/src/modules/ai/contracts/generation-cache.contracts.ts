import type {
  GeneratedQuestionOutput,
  GenerationParameters,
} from './llm-provider.contracts';

export const GENERATION_CACHE = Symbol('GENERATION_CACHE');

export interface GenerationCacheEntry {
  readonly cacheKey: string;
  readonly model: string;
  readonly output: GeneratedQuestionOutput;
  readonly parameters: GenerationParameters;
  readonly promptFingerprint: string;
}

export interface GenerationCache {
  findDecodedOutput(cacheKey: string): Promise<GeneratedQuestionOutput | null>;
  saveDecodedOutput(entry: GenerationCacheEntry): Promise<void>;
}
