import type { LlmProvider } from './llm-provider.contracts';

export const CUSTOM_MODEL_PROVIDER = Symbol('CUSTOM_MODEL_PROVIDER');

export interface CustomModelProvider {
  resolve(ownerId: string, customModelConfigId: string): Promise<LlmProvider>;
}
