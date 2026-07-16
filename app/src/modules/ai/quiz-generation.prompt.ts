import { createHash } from 'crypto';

import type {
  GenerationParameters,
  JsonObject,
  JsonValue,
} from './contracts/llm-provider.contracts';

export const QUIZ_GENERATION_PARAMETERS: GenerationParameters = {
  format: 'mcq-single-select-v1',
  maxOutputTokens: 1000,
  questionsPerChunk: 1,
};

export const QUIZ_GENERATION_PROMPT_TEMPLATE = [
  'Generate grounded multiple-choice questions from only the supplied source text.',
  'Return JSON with a questions array. Each question contains stem, explanation, and options.',
  'Each options item contains content and isCorrect. Exactly one option must be correct.',
].join('\n');

export interface PromptFingerprintInput {
  readonly params: GenerationParameters;
  readonly providerIdentity: string;
  readonly template: string;
}

export interface GenerationCacheKeyInput extends PromptFingerprintInput {
  readonly sourceText: string;
}

export function createPromptFingerprint(input: PromptFingerprintInput): string {
  return sha256([
    'prompt-template',
    input.template,
    'provider-identity',
    input.providerIdentity,
    'parameters',
    canonicalizeJson(input.params),
  ].join('\n'));
}

export function createGenerationCacheKey(input: GenerationCacheKeyInput): string {
  return sha256([
    'source-text',
    normalizeGenerationInput(input.sourceText),
    'prompt-template',
    input.template,
    'provider-identity',
    input.providerIdentity,
    'parameters',
    canonicalizeJson(input.params),
  ].join('\n'));
}

export function normalizeGenerationInput(value: string): string {
  return value.normalize('NFC').replace(/\r\n|\r/gu, '\n');
}

function canonicalizeJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (isJsonObject(value)) return canonicalizeObject(value);
  return JSON.stringify(value);
}

function canonicalizeObject(value: JsonObject): string {
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(',')}}`;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
