import type { QuizMode } from "@/lib/types";

export interface QuizDraftState {
  readonly answers: Readonly<Record<string, string | null>>;
  readonly currentIndex: number;
  readonly elapsedSec: number;
  readonly flaggedQuestionIds: readonly string[];
  readonly mode: QuizMode;
  readonly updatedAt: string;
}

const QUIZ_DRAFT_PREFIX = "learning-platform:quiz-draft";

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    if (error instanceof DOMException) return;
    throw error;
  }
}

function removeStorageValue(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch (error) {
    if (error instanceof DOMException) return;
    throw error;
  }
}

export function getQuizDraftKey(quizId: string, mode: QuizMode): string {
  return `${QUIZ_DRAFT_PREFIX}:${quizId}:${mode}`;
}

export function readQuizDraft(
  quizId: string,
  mode: QuizMode,
): QuizDraftState | null {
  const rawValue = readStorageValue(getQuizDraftKey(quizId, mode));

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as QuizDraftState;
  } catch {
    return null;
  }
}

export function writeQuizDraft(
  quizId: string,
  mode: QuizMode,
  draft: QuizDraftState,
): void {
  writeStorageValue(getQuizDraftKey(quizId, mode), JSON.stringify(draft));
}

export function clearQuizDraft(quizId: string, mode: QuizMode): void {
  removeStorageValue(getQuizDraftKey(quizId, mode));
}
