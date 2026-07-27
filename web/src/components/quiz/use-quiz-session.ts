import { useEffect, useMemo, useRef, useState } from "react";
import { readQuizDraft, writeQuizDraft } from "@/components/quiz/quiz-session";
import type { Phase0QuizResponse } from "@/lib/phase0/contracts";
import type { QuizMode } from "@/lib/types";
import { createDraftSnapshot, sanitizeDraft, type QuizDraftSnapshot } from "./quiz-play-utils";

interface UseQuizSessionParams {
  readonly quiz: Phase0QuizResponse;
  readonly mode: QuizMode;
  readonly resume: boolean;
}

interface UseQuizSessionResult {
  readonly draftState: QuizDraftSnapshot;
  readonly draftStateRef: React.RefObject<QuizDraftSnapshot>;
  readonly isDraftReady: boolean;
  readonly updateDraftState: (transform: (currentDraft: QuizDraftSnapshot) => QuizDraftSnapshot) => void;
  readonly persistDraftSnapshot: (snapshot: QuizDraftSnapshot) => void;
}

export function useQuizSession({ quiz, mode, resume }: UseQuizSessionParams): UseQuizSessionResult {
  const initialDraft = useMemo(() => sanitizeDraft(quiz, null), [quiz]);
  const [draftState, setDraftState] = useState<QuizDraftSnapshot>({
    answers: initialDraft.answers,
    currentIndex: initialDraft.currentIndex,
    elapsedSec: initialDraft.elapsedSec,
    flaggedQuestionIds: [...initialDraft.flaggedQuestionIds],
  });
  const [hasRestoredDraft, setHasRestoredDraft] = useState<boolean>(!resume);
  const draftStateRef = useRef<QuizDraftSnapshot>(draftState);
  const isDraftReady = !resume || hasRestoredDraft;

  useEffect(() => {
    if (!resume) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      const restoredDraft = sanitizeDraft(quiz, readQuizDraft(quiz.id, mode));
      setDraftState({
        answers: restoredDraft.answers,
        currentIndex: restoredDraft.currentIndex,
        elapsedSec: restoredDraft.elapsedSec,
        flaggedQuestionIds: [...restoredDraft.flaggedQuestionIds],
      });
      setHasRestoredDraft(true);
    });

    return () => {
      cancelled = true;
    };
  }, [mode, quiz, quiz.id, resume]);

  useEffect(() => {
    if (!isDraftReady) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setDraftState((currentDraft) => ({
        ...currentDraft,
        elapsedSec: currentDraft.elapsedSec + 1,
      }));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDraftReady]);

  useEffect(() => {
    if (!isDraftReady) {
      return;
    }

    writeQuizDraft(quiz.id, mode, {
      answers: draftState.answers,
      currentIndex: draftState.currentIndex,
      elapsedSec: draftState.elapsedSec,
      flaggedQuestionIds: draftState.flaggedQuestionIds,
      mode,
      updatedAt: new Date().toISOString(),
    });
  }, [draftState, isDraftReady, mode, quiz.id]);

  useEffect(() => {
    draftStateRef.current = draftState;
  }, [draftState]);

  function updateDraftState(transform: (currentDraft: QuizDraftSnapshot) => QuizDraftSnapshot): void {
    const nextDraftState = transform(draftStateRef.current);
    draftStateRef.current = nextDraftState;
    setDraftState(nextDraftState);
  }

  function persistDraftSnapshot(snapshot: QuizDraftSnapshot): void {
    writeQuizDraft(quiz.id, mode, createDraftSnapshot(snapshot, mode));
  }

  return {
    draftState,
    draftStateRef,
    isDraftReady,
    updateDraftState,
    persistDraftSnapshot,
  };
}
