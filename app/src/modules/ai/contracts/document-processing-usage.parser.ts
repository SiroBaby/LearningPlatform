import type { DocumentProcessingUsage } from './document-processing-result';

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Parses the optional `usage` block of a DocumentProcessingResult payload. Returns null when the block is malformed
 * (callers fall back to the conservative no-usage rule instead of blocking on one event). Absent/null input is the
 * caller's concern: pass only a present value.
 */
export function parseDocumentProcessingUsageBlock(value: unknown): DocumentProcessingUsage | null {
  if (typeof value !== 'object' || value === null) return null;
  const usage = value as Record<string, unknown>;
  if (!Array.isArray(usage.llm)) return null;
  const llm: DocumentProcessingUsage['llm'][number][] = [];
  for (const entry of usage.llm as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { inputTokens, model, outputTokens } = entry as Record<string, unknown>;
    if (typeof model !== 'string' || model.trim() === '' || !isNonNegativeSafeInteger(inputTokens) || !isNonNegativeSafeInteger(outputTokens)) {
      return null;
    }
    llm.push({ inputTokens, model, outputTokens });
  }
  const uncertainDispatches = usage.uncertainDispatches ?? 0;
  const sttBilledSeconds = usage.sttBilledSeconds ?? null;
  const sttUncertainSeconds = usage.sttUncertainSeconds ?? null;
  if (
    !isNonNegativeSafeInteger(uncertainDispatches) ||
    (sttBilledSeconds !== null && !isNonNegativeSafeInteger(sttBilledSeconds)) ||
    (sttUncertainSeconds !== null && !isNonNegativeSafeInteger(sttUncertainSeconds))
  ) {
    return null;
  }
  return { llm, sttBilledSeconds, sttUncertainSeconds, uncertainDispatches };
}
