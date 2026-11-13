"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getCheckpointProgressKey,
  parseCheckpointProgress,
  serializeCheckpointProgress,
} from "@/lib/media-checkpoints/checkpoint-progress";
import type { CheckpointAnswerMap } from "@/lib/media-checkpoints/checkpoint-progress";

export interface UseCheckpointProgressResult {
  /** Answers saved by an earlier visit; empty until `isRestored`. */
  readonly restored: CheckpointAnswerMap;
  /** False during SSR and the first render: storage is only read after mount. */
  readonly isRestored: boolean;
  persist(answered: CheckpointAnswerMap): void;
}

const EMPTY_ANSWERS: CheckpointAnswerMap = {};

function readStorage(key: string): string | null {
  try {
    return globalThis.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Browser-tab memory of answered checkpoints, restored after mount to keep SSR markup stable. */
export function useCheckpointProgress(quizId: string | null): UseCheckpointProgressResult {
  const [restoredState, setRestoredState] = useState<{ readonly quizId: string; readonly answered: CheckpointAnswerMap } | null>(null);

  useEffect(() => {
    if (quizId === null) return;
    // Reading storage can only happen after mount; this is the one-time restore.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestoredState({ quizId, answered: parseCheckpointProgress(readStorage(getCheckpointProgressKey(quizId))) });
  }, [quizId]);

  const persist = useCallback((answered: CheckpointAnswerMap): void => {
    if (quizId === null) return;
    try {
      globalThis.sessionStorage.setItem(getCheckpointProgressKey(quizId), serializeCheckpointProgress(answered));
    } catch {
      // Storage may be blocked; progress then lives in memory only.
    }
  }, [quizId]);

  const isRestored = quizId !== null && restoredState?.quizId === quizId;
  return {
    restored: isRestored && restoredState ? restoredState.answered : EMPTY_ANSWERS,
    isRestored,
    persist,
  };
}
