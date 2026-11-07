import type { PlanModelCatalogItem } from '../../ai/contracts/model-selection.contracts';
import {
  EXTRACTED_TEXT_CHARS_PER_TOKEN,
  GENERATION_OUTPUT_TOKENS_PER_QUESTION,
  GENERATION_PROMPT_OVERHEAD_TOKENS,
} from './credit-estimation.constants';

export interface TextCreditEstimateInput {
  /** Number of chunks Go will generate one question for (one provider call each). */
  readonly chunkCount: number;
  /** Total characters of the chunk text, as measured by the extraction job. */
  readonly extractedChars: number;
  readonly model: PlanModelCatalogItem;
}

/**
 * Pure estimate of the credits the generation pass will spend, from the REAL extracted text (ADR-0033):
 *
 *   inputTokens  = chunkCount * GENERATION_PROMPT_OVERHEAD_TOKENS + ceil(extractedChars / EXTRACTED_TEXT_CHARS_PER_TOKEN)
 *   outputTokens = chunkCount * GENERATION_OUTPUT_TOKENS_PER_QUESTION
 *   credits      = max(1, inputTokens * model.creditPerInputToken + outputTokens * model.creditPerOutputToken)
 */
export function estimateTextCredits(input: TextCreditEstimateInput): number {
  const { chunkCount, extractedChars, model } = input;
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1) {
    throw new RangeError('Chunk count must be a positive whole number');
  }
  if (!Number.isSafeInteger(extractedChars) || extractedChars < 1) {
    throw new RangeError('Extracted characters must be a positive whole number');
  }
  const inputTokens = chunkCount * GENERATION_PROMPT_OVERHEAD_TOKENS +
    Math.ceil(extractedChars / EXTRACTED_TEXT_CHARS_PER_TOKEN);
  const outputTokens = chunkCount * GENERATION_OUTPUT_TOKENS_PER_QUESTION;
  return Math.max(1, inputTokens * model.creditPerInputToken + outputTokens * model.creditPerOutputToken);
}
