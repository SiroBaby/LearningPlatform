/** Coarse heuristic shared by the PDF/TXT pre-upload estimate: 1 token per 4 bytes of text. */
export const COARSE_INPUT_TOKEN_BYTES = 4;

/** Output-token allowance used for every coarse estimate (PDF/TXT pre-upload and media after probe). */
export const COARSE_OUTPUT_TOKEN_CAP = 256;
