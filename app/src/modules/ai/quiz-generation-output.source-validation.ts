import type { GeneratedQuestionOutput } from './contracts/llm-provider.contracts';
import { QuizGenerationError, QuizGenerationErrorCode } from './quiz-generation-error';
import { normalizeGenerationInput } from './quiz-generation.prompt';

const MINIMUM_MATCH_TOKENS = 6;
const MINIMUM_MATCH_CHARACTERS = 30;
const MAXIMUM_TOKENS_TO_REACH_MINIMUM_CHARACTERS = 30;
const ENGLISH_TOKEN_PATTERN = /[A-Za-z][A-Za-z0-9_-]*/gu;

interface IndexedToken {
  readonly value: string;
}

export function validateGeneratedQuestionOutputAgainstSource(
  sourceText: string,
  output: GeneratedQuestionOutput,
): void {
  const sourceTokens = tokenizeEnglishLikeWords(sourceText);
  if (sourceTokens.length < MINIMUM_MATCH_TOKENS) return;

  const sourceWindows = createShortestQualifyingWindowSet(sourceTokens);
  for (const question of output.questions) {
    rejectIfCopiedEnglishSequence(question.stem, sourceWindows);
    rejectIfCopiedEnglishSequence(question.explanation, sourceWindows);
    for (const option of question.options) {
      rejectIfCopiedEnglishSequence(option.content, sourceWindows);
    }
  }
}

function rejectIfCopiedEnglishSequence(
  generatedText: string,
  sourceWindows: ReadonlySet<string>,
): void {
  const generatedTokens = tokenizeEnglishLikeWords(generatedText);
  if (generatedTokens.length < MINIMUM_MATCH_TOKENS) return;

  for (
    let generatedStart = 0;
    generatedStart <= generatedTokens.length - MINIMUM_MATCH_TOKENS;
    generatedStart += 1
  ) {
    const shortestQualifyingLength = findShortestQualifyingLength(generatedTokens, generatedStart);
    if (shortestQualifyingLength === null) continue;

    const minimumWindowKey = buildSequenceKey(
      generatedTokens,
      generatedStart,
      shortestQualifyingLength,
    );
    if (sourceWindows.has(minimumWindowKey)) {
      throw malformedOutput();
    }
  }
}

function tokenizeEnglishLikeWords(text: string): readonly IndexedToken[] {
  const normalized = normalizeGenerationInput(text);
  const tokens: IndexedToken[] = [];
  for (const match of normalized.matchAll(ENGLISH_TOKEN_PATTERN)) {
    const value = match[0];
    if (value === undefined) continue;
    tokens.push({ value });
  }
  return tokens;
}

function createShortestQualifyingWindowSet(tokens: readonly IndexedToken[]): ReadonlySet<string> {
  const windows = new Set<string>();
  for (let start = 0; start <= tokens.length - MINIMUM_MATCH_TOKENS; start += 1) {
    const shortestQualifyingLength = findShortestQualifyingLength(tokens, start);
    if (shortestQualifyingLength === null) continue;
    windows.add(buildSequenceKey(tokens, start, shortestQualifyingLength));
  }
  return windows;
}

function findShortestQualifyingLength(
  tokens: readonly IndexedToken[],
  start: number,
): number | null {
  let characterCount = 0;
  const maximumLength = Math.min(
    MAXIMUM_TOKENS_TO_REACH_MINIMUM_CHARACTERS,
    tokens.length - start,
  );

  for (let offset = 0; offset < maximumLength; offset += 1) {
    const token = tokens[start + offset];
    if (!token) return null;
    characterCount += token.value.length;

    const windowLength = offset + 1;
    if (
      windowLength >= MINIMUM_MATCH_TOKENS &&
      characterCount >= MINIMUM_MATCH_CHARACTERS
    ) {
      return windowLength;
    }
  }
  return null;
}

function buildSequenceKey(
  tokens: readonly IndexedToken[],
  start: number,
  length: number,
): string {
  return tokens.slice(start, start + length).map((token) => token.value).join('\u0001');
}

function malformedOutput(): QuizGenerationError {
  return new QuizGenerationError(QuizGenerationErrorCode.GENERATION_OUTPUT_INVALID);
}
