/** Coarse heuristic shared by the PDF/TXT pre-upload estimate: 1 token per 4 bytes of text. */
export const COARSE_INPUT_TOKEN_BYTES = 4;

/** Output-token allowance used for every coarse estimate (PDF/TXT pre-upload and media after probe). */
export const COARSE_OUTPUT_TOKEN_CAP = 256;

/**
 * PDF/TXT reservation after extraction (ADR-0033). Heuristics, not measurements: calibrate with 3-5 real files
 * (Owner decision on #281). Vietnamese text tokenizes at roughly 2.5-3.5 characters per token; 3 rounds up.
 */
export const EXTRACTED_TEXT_CHARS_PER_TOKEN = 3;

/** Instructions plus schema tokens that Go sends with every chunk (one provider call per chunk). */
export const GENERATION_PROMPT_OVERHEAD_TOKENS = 200;

/** One Vietnamese MCQ with explanation, including headroom for provider-side reasoning tokens. */
export const GENERATION_OUTPUT_TOKENS_PER_QUESTION = 600;
