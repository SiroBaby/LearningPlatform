export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export type JsonPrimitive = boolean | null | number | string;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonObject | JsonPrimitive | readonly JsonValue[];

export interface GeneratedOptionOutput {
  readonly content: string;
  readonly isCorrect: boolean;
}

export interface GeneratedQuestionOutputItem {
  readonly explanation: string;
  readonly options: readonly GeneratedOptionOutput[];
  readonly stem: string;
}

export interface GeneratedQuestionOutput {
  readonly questions: readonly GeneratedQuestionOutputItem[];
}

export interface GenerationParameters extends JsonObject {
  readonly format: 'mcq-single-select-v1';
  readonly maxOutputTokens: 1000;
  readonly questionsPerChunk: 1;
}

export interface LlmGenerationRequest {
  readonly parameters: GenerationParameters;
  readonly promptTemplate: string;
  readonly sourceText: string;
}

export interface LlmGenerationResult {
  readonly output: unknown;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  };
}

export interface LlmProvider {
  readonly model: string;
  readonly providerIdentity: string;
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}
