import type { GenerationParameters } from './llm-provider.contracts';

export const PROMPT_VERSION_STORE = Symbol('PROMPT_VERSION_STORE');

export interface PromptVersionEntry {
  readonly fingerprint: string;
  readonly model: string;
  readonly parameters: GenerationParameters;
  readonly template: string;
}

export interface PromptVersionStore {
  record(entry: PromptVersionEntry): Promise<void>;
}
