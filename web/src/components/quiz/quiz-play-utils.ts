import type { Phase0PracticeFeedbackResponse, Phase0QuizResponse } from "@/lib/phase0/contracts";
import type { Citation, QuizMode } from "@/lib/types";
import type { QuizDraftState } from "@/components/quiz/quiz-session";

export interface MissingAnswerSummary {
  readonly count: number;
  readonly firstQuestionId: string;
  readonly firstDisplayPosition: number;
}

export interface QuestionPracticeFeedbackState {
  readonly selectedOptionId: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly response: Phase0PracticeFeedbackResponse | null;
}

export interface QuizDraftSnapshot {
  readonly answers: Record<string, string | null>;
  readonly currentIndex: number;
  readonly elapsedSec: number;
  readonly flaggedQuestionIds: string[];
}

export function formatDuration(totalSec: number): string {
  const safeTotal = Math.max(0, totalSec);
  const hours = Math.floor(safeTotal / 3600);
  const minutes = Math.floor((safeTotal % 3600) / 60);
  const seconds = safeTotal % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function createEmptyAnswers(quiz: Phase0QuizResponse): Record<string, string | null> {
  return Object.fromEntries(quiz.questions.map((question) => [question.id, null]));
}

export function buildSubmitAnswers(
  quiz: Phase0QuizResponse,
  answers: Readonly<Record<string, string | null>>,
): Array<{ questionId: string; optionId: string }> {
  return quiz.questions.flatMap((question) => {
    const optionId = answers[question.id];
    if (typeof optionId !== "string") {
      return [];
    }
    return [{ questionId: question.id, optionId }];
  });
}

export function sanitizeDraft(quiz: Phase0QuizResponse, draft: QuizDraftState | null): QuizDraftState {
  const validQuestionIds = new Set(quiz.questions.map((question) => question.id));
  const validOptionsByQuestion = new Map(
    quiz.questions.map((question) => [question.id, new Set(question.options.map((option) => option.id))]),
  );
  const answers = createEmptyAnswers(quiz);

  if (draft) {
    for (const question of quiz.questions) {
      const selectedOptionId = draft.answers[question.id];
      if (typeof selectedOptionId !== "string") {
        continue;
      }
      if (validOptionsByQuestion.get(question.id)?.has(selectedOptionId)) {
        answers[question.id] = selectedOptionId;
      }
    }
  }

  const currentIndex = draft ? Math.min(Math.max(draft.currentIndex, 0), Math.max(quiz.questions.length - 1, 0)) : 0;

  return {
    answers,
    currentIndex,
    elapsedSec: draft ? Math.max(0, draft.elapsedSec) : 0,
    flaggedQuestionIds: draft
      ? draft.flaggedQuestionIds.filter((questionId) => validQuestionIds.has(questionId))
      : [],
    mode: draft?.mode ?? "practice",
    updatedAt: draft?.updatedAt ?? new Date().toISOString(),
  };
}

export function getQuestionTone(
  questionId: string,
  currentQuestionId: string,
  flaggedSet: ReadonlySet<string>,
  answers: Readonly<Record<string, string | null>>,
): string {
  if (questionId === currentQuestionId) {
    return "border-brand-300 bg-brand-50 text-brand-700";
  }
  if (flaggedSet.has(questionId)) {
    return "border-warning-200 bg-warning-50 text-warning-800";
  }
  if (answers[questionId]) {
    return "border-success-200 bg-success-50 text-success-800";
  }
  return "border-ink-200 bg-white text-ink-600 hover:border-brand-200 hover:bg-brand-50/40";
}

export function getDisplayPosition(index: number): number {
  return index + 1;
}

export function toCitationSnippet(feedback: Phase0PracticeFeedbackResponse): Citation {
  return {
    chunkId: feedback.citation.chunkId,
    locator: feedback.citation.locator,
    snippet: feedback.citation.snippet,
    documentId: "",
    documentTitle: "Nguồn giải thích",
  };
}

export function createDraftSnapshot(draft: QuizDraftSnapshot, mode: QuizMode): QuizDraftState {
  return {
    answers: draft.answers,
    currentIndex: draft.currentIndex,
    elapsedSec: draft.elapsedSec,
    flaggedQuestionIds: draft.flaggedQuestionIds,
    mode,
    updatedAt: new Date().toISOString(),
  };
}
