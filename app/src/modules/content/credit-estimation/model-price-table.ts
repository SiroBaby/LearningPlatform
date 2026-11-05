/**
 * Versioned provider price table used ONLY to convert speech-to-text (STT) cost into the existing
 * wallet unit (decision D2 of issue #160: 1 credit = 1 input token of the default platform model).
 *
 * Prices are stored as integer micro-USD (1 USD = 1_000_000 micro-USD) so conversions stay exact.
 *
 * IMPORTANT: these numbers are NOT fetched from a provider. They MUST be verified against the
 * provider pricing page before enabling media in a real environment; a wrong value silently
 * mis-prices STT credits. Issue #268 will redesign credits around real cost and replace this table.
 */
export const MODEL_PRICE_TABLE_VERSION = '2026-11-05';

export interface LlmModelPrice {
  /** Micro-USD per 1,000,000 input tokens. */
  readonly inputMicroUsdPerMillionTokens: number;
  /** Micro-USD per 1,000,000 output tokens. */
  readonly outputMicroUsdPerMillionTokens: number;
}

export interface SttModelPrice {
  /** Micro-USD per minute of audio. */
  readonly microUsdPerMinute: number;
}

export interface ModelPriceTable {
  readonly llm: Readonly<Record<string, LlmModelPrice>>;
  readonly stt: Readonly<Record<string, SttModelPrice>>;
  readonly version: string;
}

/** Name of the STT model whose price converts media duration into credits (D1: `whisper-1`). */
export const DEFAULT_STT_MODEL = 'whisper-1';

export const DEFAULT_MODEL_PRICE_TABLE: ModelPriceTable = {
  version: MODEL_PRICE_TABLE_VERSION,
  llm: {
    // UNVERIFIED: recalled list price ($0.75 in / $4.50 out per 1M tokens). Verify before rollout.
    'gpt-5.4-mini': { inputMicroUsdPerMillionTokens: 750_000, outputMicroUsdPerMillionTokens: 4_500_000 },
    // $0.40 in / $1.60 out per 1M tokens (OpenAI list price; fallback default model in ai.config).
    'gpt-4.1-mini': { inputMicroUsdPerMillionTokens: 400_000, outputMicroUsdPerMillionTokens: 1_600_000 },
  },
  stt: {
    // $0.006 per minute (OpenAI list price for whisper-1).
    'whisper-1': { microUsdPerMinute: 6_000 },
  },
};

export class ModelPriceTableError extends Error {}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ModelPriceTableError(`Model price table: ${label} must be a positive integer`);
  }
}

/** Fail-fast validation so a malformed table can never silently produce zero or NaN credits. */
export function validateModelPriceTable(table: ModelPriceTable): ModelPriceTable {
  if (!table.version.trim()) throw new ModelPriceTableError('Model price table: version is required');
  if (Object.keys(table.llm).length === 0) throw new ModelPriceTableError('Model price table: llm prices are required');
  if (Object.keys(table.stt).length === 0) throw new ModelPriceTableError('Model price table: stt prices are required');
  for (const [model, price] of Object.entries(table.llm)) {
    assertPositiveSafeInteger(price.inputMicroUsdPerMillionTokens, `llm.${model}.inputMicroUsdPerMillionTokens`);
    assertPositiveSafeInteger(price.outputMicroUsdPerMillionTokens, `llm.${model}.outputMicroUsdPerMillionTokens`);
  }
  for (const [model, price] of Object.entries(table.stt)) {
    assertPositiveSafeInteger(price.microUsdPerMinute, `stt.${model}.microUsdPerMinute`);
  }
  return table;
}

/** Boot-time check: every configured platform model and the STT model must have a price. */
export function assertPlatformModelsPriced(table: ModelPriceTable, models: readonly string[]): void {
  const missing = models.filter((model) => !table.llm[model]);
  if (missing.length > 0) {
    throw new ModelPriceTableError(`Model price table has no price for platform model(s): ${missing.join(', ')}`);
  }
  if (!table.stt[DEFAULT_STT_MODEL]) {
    throw new ModelPriceTableError(`Model price table has no price for STT model ${DEFAULT_STT_MODEL}`);
  }
}
