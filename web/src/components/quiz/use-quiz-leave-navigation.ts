import { useCallback, useEffect, useRef } from "react";
import { routes } from "@/lib/routes";
import { writeQuizDraft } from "@/components/quiz/quiz-session";
import { createDraftSnapshot, type QuizDraftSnapshot } from "./quiz-play-utils";
import {
  confirmQuizNavigation,
  type ConfirmNavigationOptions,
} from "./quiz-navigation-guard";
import type { QuizMode } from "@/lib/types";

interface UseQuizLeaveNavigationParams {
  readonly isDraftReady: boolean;
  readonly quizId: string;
  readonly mode: QuizMode;
  readonly getDraftSnapshot: () => QuizDraftSnapshot;
  readonly onBeforeConfirmedLeave?: () => void;
}

export function useQuizLeaveNavigation({
  isDraftReady,
  quizId,
  mode,
  getDraftSnapshot,
  onBeforeConfirmedLeave,
}: UseQuizLeaveNavigationParams): (options?: ConfirmNavigationOptions) => void {
  const isNavigationConfirmedRef = useRef<boolean>(false);
  const cleanupNavigationGuardsRef = useRef<(() => void) | null>(null);

  const persistLatestDraft = useCallback(() => {
    writeQuizDraft(quizId, mode, createDraftSnapshot(getDraftSnapshot(), mode));
  }, [getDraftSnapshot, mode, quizId]);

  const confirmInternalLeave = useCallback((options: ConfirmNavigationOptions = {}) => {
    confirmQuizNavigation({
      markConfirmed: () => {
        isNavigationConfirmedRef.current = true;
      },
      cleanup: () => {
        cleanupNavigationGuardsRef.current?.();
        cleanupNavigationGuardsRef.current = null;
      },
      onBeforeConfirmedLeave,
      persistDraft: persistLatestDraft,
    }, options);
  }, [onBeforeConfirmedLeave, persistLatestDraft]);

  useEffect(() => {
    if (!isDraftReady) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isNavigationConfirmedRef.current) {
        return;
      }

      persistLatestDraft();
      event.preventDefault();
      event.returnValue = "";
    };

    const handlePopState = () => {
      if (isNavigationConfirmedRef.current) {
        return;
      }

      const confirmed = window.confirm("Rời bài và lưu phần đang làm?");
      if (confirmed) {
        confirmInternalLeave();
        queueMicrotask(() => {
          window.location.assign(routes.quizStart(quizId));
        });
        return;
      }

      window.history.pushState({ quizId, mode }, "", window.location.href);
    };

    const cleanupNavigationGuards = () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    };

    window.history.pushState({ quizId, mode }, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    cleanupNavigationGuardsRef.current = cleanupNavigationGuards;

    return () => {
      cleanupNavigationGuards();
      if (cleanupNavigationGuardsRef.current === cleanupNavigationGuards) {
        cleanupNavigationGuardsRef.current = null;
      }
    };
  }, [confirmInternalLeave, isDraftReady, mode, persistLatestDraft, quizId]);

  return confirmInternalLeave;
}
