"use client";

import { useCallback, useEffect, useState } from "react";

import { getPhase0Quiz } from "@/lib/phase0/client";
import type { Phase0QuizQuestion } from "@/lib/phase0/contracts";

export type CheckpointQuizLoadState = "idle" | "loading" | "ready" | "error" | "empty";

/** A served question with its position in the served list (the learner sees `servedIndex + 1`). */
export interface ServedCheckpointQuestion extends Phase0QuizQuestion {
  readonly servedIndex: number;
}

export interface UseCheckpointQuizResult {
  readonly loadState: CheckpointQuizLoadState;
  readonly questions: readonly ServedCheckpointQuestion[];
  retry(): void;
}

interface LoadedQuiz {
  readonly quizId: string;
  readonly status: "ready" | "error";
  readonly questions: readonly ServedCheckpointQuestion[];
}

function toServedQuestions(questions: readonly Phase0QuizQuestion[]): readonly ServedCheckpointQuestion[] {
  return questions.map((question, servedIndex) => ({ ...question, servedIndex }));
}

function resolveLoadState(quizId: string | null, loaded: LoadedQuiz | null): CheckpointQuizLoadState {
  if (quizId === null) return "idle";
  if (loaded === null || loaded.quizId !== quizId) return "loading";
  if (loaded.status === "error") return "error";
  return loaded.questions.some((question) => question.timeRange !== null) ? "ready" : "empty";
}

/** Loads the served quiz of a media document; failures never affect playback. */
export function useCheckpointQuiz(quizId: string | null): UseCheckpointQuizResult {
  const [loaded, setLoaded] = useState<LoadedQuiz | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (quizId === null) return undefined;
    const abortController = new AbortController();
    getPhase0Quiz(quizId, abortController.signal)
      .then((quiz) => {
        if (abortController.signal.aborted) return;
        setLoaded({ quizId, status: "ready", questions: toServedQuestions(quiz.questions) });
      })
      .catch(() => {
        if (abortController.signal.aborted) return;
        setLoaded({ quizId, status: "error", questions: [] });
      });
    return () => abortController.abort();
  }, [quizId, attempt]);

  const retry = useCallback((): void => {
    setLoaded(null);
    setAttempt((current) => current + 1);
  }, []);

  return {
    loadState: resolveLoadState(quizId, loaded),
    questions: loaded !== null && loaded.quizId === quizId ? loaded.questions : [],
    retry,
  };
}
