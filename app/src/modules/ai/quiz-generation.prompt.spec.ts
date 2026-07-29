import { describe, expect, it } from '@jest/globals';

import {
  createGenerationCacheKey,
  createPromptFingerprint,
  QUIZ_GENERATION_PARAMETERS,
  QUIZ_GENERATION_PROMPT_TEMPLATE,
} from './quiz-generation.prompt';

describe('quiz generation prompt fingerprints', () => {
  it('allows 4000 output tokens for complete quiz generation', () => {
    expect(QUIZ_GENERATION_PARAMETERS.maxOutputTokens).toBe(4000);
  });

  it('instructs the provider to return one JSON-only question per chunk', () => {
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('exactly one question');
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('exact top-level shape');
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('{"questions":[');
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('Do not return a singular "question" key');
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('JSON only');
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain('no markdown fences or prose');
  });

  it('requires Vietnamese-first learner-facing content while preserving reused English source terms exactly', () => {
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain(
      'Write the stem, every option content, and the explanation in natural Vietnamese even when the source text is fully English or mixed-language.',
    );
    expect(QUIZ_GENERATION_PROMPT_TEMPLATE).toContain(
      'When reusing English technical terms, abbreviations, proper names, product names, API names, code identifiers, or quoted source phrases, preserve them exactly as they appear in the source.',
    );
  });

  it('normalizes Unicode and line endings for cache identity', () => {
    const input = {
      params: { format: 'mcq-single-select-v1' as const, maxOutputTokens: 4000 as const, questionsPerChunk: 1 as const },
      providerIdentity: 'provider-v1',
      sourceText: 'Cafe\u0301\r\nSecond line\rThird line',
      template: 'Generate grounded questions for {{SOURCE_TEXT}}.',
    };

    expect(createGenerationCacheKey(input)).toBe(createGenerationCacheKey({
      ...input,
      sourceText: 'Café\nSecond line\nThird line',
    }));
  });

  it('changes prompt fingerprint and cache key when the template changes', () => {
    const base = {
      params: { format: 'mcq-single-select-v1' as const, maxOutputTokens: 4000 as const, questionsPerChunk: 1 as const },
      providerIdentity: 'provider-v1',
      sourceText: 'source',
      template: 'Template one {{SOURCE_TEXT}}.',
    };
    const changed = { ...base, template: 'Template two {{SOURCE_TEXT}}.' };

    expect(createPromptFingerprint(base)).not.toBe(createPromptFingerprint(changed));
    expect(createGenerationCacheKey(base)).not.toBe(createGenerationCacheKey(changed));
  });

  it('isolates prompt and cache fingerprints by provider identity', () => {
    const base = {
      params: { format: 'mcq-single-select-v1' as const, maxOutputTokens: 4000 as const, questionsPerChunk: 1 as const },
      providerIdentity: 'provider-one',
      sourceText: 'source',
      template: 'template',
    };
    const changed = { ...base, providerIdentity: 'provider-two' };

    expect(createPromptFingerprint(base)).not.toBe(createPromptFingerprint(changed));
    expect(createGenerationCacheKey(base)).not.toBe(createGenerationCacheKey(changed));
  });
});
