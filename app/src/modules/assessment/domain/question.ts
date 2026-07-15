import type {
  CitationCandidate,
  CitationLocator,
  QuestionCandidate,
} from '../contracts/quiz-generation-handoff.contract';
import { sha256, uuidFromSha256 } from './deterministic-id';

export interface QuestionOption {
  readonly content: string;
  readonly id: string;
  readonly isCorrect: boolean;
  readonly optionIndex: number;
}

export class Question {
  private constructor(
    readonly chunkId: string,
    readonly chunkIndex: number,
    readonly citation: CitationCandidate,
    readonly explanation: string,
    readonly id: string,
    readonly idempotencyKey: string,
    readonly normalizedStem: string,
    readonly options: readonly QuestionOption[],
    readonly ordinal: number,
    readonly stem: string,
  ) {}

  static create(candidate: QuestionCandidate, quizId: string): Question | null {
    const stem = candidate.stem.trim();
    const explanation = candidate.explanation.trim();
    const snippet = candidate.citation.snippet.trim();
    const options = candidate.options.map((option, optionIndex) => ({
      content: option.content.trim(),
      isCorrect: option.isCorrect,
      optionIndex,
    }));
    const key = sha256(`${quizId}:${candidate.chunkId}:${candidate.ordinal}`);

    if (
      stem.length === 0 ||
      explanation.length === 0 ||
      snippet.length === 0 ||
      candidate.citation.chunkId !== candidate.chunkId ||
      !isValidLocator(candidate.citation.locator) ||
      !Number.isSafeInteger(candidate.chunkIndex) ||
      candidate.chunkIndex < 0 ||
      !Number.isSafeInteger(candidate.ordinal) ||
      candidate.ordinal < 0 ||
      options.length < 2 ||
      options.some((option) => option.content.length === 0) ||
      new Set(options.map((option) => normalize(option.content))).size !== options.length ||
      options.filter((option) => option.isCorrect).length !== 1
    ) {
      return null;
    }

    const id = uuidFromSha256(key);
    return new Question(
      candidate.chunkId,
      candidate.chunkIndex,
      { ...candidate.citation, snippet },
      explanation,
      id,
      key,
      normalize(stem),
      options.map((option) => ({
        ...option,
        id: uuidFromSha256(sha256(`${id}:${option.optionIndex}`)),
      })),
      candidate.ordinal,
      stem,
    );
  }
}

function isValidLocator(locator: CitationLocator): boolean {
  switch (locator.kind) {
    case 'page':
      return Number.isInteger(locator.page) && locator.page > 0;
    case 'text-range':
      return Number.isInteger(locator.start) && locator.start >= 0 && Number.isInteger(locator.end) && locator.end > locator.start;
    case 'time':
      return Number.isFinite(locator.startSec) && locator.startSec >= 0 && Number.isFinite(locator.endSec) && locator.endSec >= locator.startSec;
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
