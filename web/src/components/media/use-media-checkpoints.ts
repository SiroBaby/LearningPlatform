"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePracticeFeedback } from "@/components/quiz/use-practice-feedback";
import type { QuestionPracticeFeedbackState } from "@/components/quiz/quiz-play-utils";
import {
  createCheckpointEngine,
  isNearCheckpoint,
  reduceCheckpointEngine,
} from "@/lib/media-checkpoints/checkpoint-engine";
import type {
  CheckpointEngineEffect,
  CheckpointEngineEvent,
  CheckpointStatus,
} from "@/lib/media-checkpoints/checkpoint-engine";
import { findAnsweredGroupIds } from "@/lib/media-checkpoints/checkpoint-progress";
import { decideNativePlayOutcome, findNextUnansweredQuestionId } from "@/lib/media-checkpoints/checkpoint-resolution";
import type { CheckpointAnswerMap } from "@/lib/media-checkpoints/checkpoint-progress";
import { buildCheckpointGroups } from "@/lib/media-checkpoints/checkpoint-schedule";
import type { CheckpointGroup } from "@/lib/media-checkpoints/checkpoint-schedule";
import type { MediaPlayerAdapter } from "@/lib/media-playback/media-player-adapter";

import { useCheckpointProgress } from "./use-checkpoint-progress";
import { useCheckpointQuiz } from "./use-checkpoint-quiz";
import type { CheckpointQuizLoadState, ServedCheckpointQuestion } from "./use-checkpoint-quiz";

export interface UseMediaCheckpointsOptions {
  readonly adapter: MediaPlayerAdapter;
  readonly quizId: string | null;
  readonly durationSec: number | null;
  /** Returns focus to the media element after playback resumes. */
  readonly focusMedia?: () => void;
}

export interface CheckpointListItem {
  readonly group: CheckpointGroup;
  readonly status: CheckpointStatus;
}

/** The question shown while playback is stopped. */
export interface OpenCheckpointView {
  readonly groupId: string;
  readonly atSec: number;
  readonly question: ServedCheckpointQuestion;
  readonly selectedOptionId: string | null;
  readonly feedback: QuestionPracticeFeedbackState | null;
  readonly isLastInGroup: boolean;
}

export interface UseMediaCheckpointsResult {
  readonly loadState: CheckpointQuizLoadState;
  readonly items: readonly CheckpointListItem[];
  readonly timedQuestionCount: number;
  readonly isPauseEnabled: boolean;
  readonly openCheckpoint: OpenCheckpointView | null;
  retryLoad(): void;
  setPauseEnabled(isEnabled: boolean): void;
  selectOption(optionId: string): void;
  checkAnswer(): void;
  advance(): void;
  skip(): void;
  seekToSeconds(timeSec: number): void;
}

interface EngineView {
  readonly statuses: Readonly<Record<string, CheckpointStatus>>;
  readonly openGroupId: string | null;
  readonly enabled: boolean;
}

const RESUME_SEEK_TOLERANCE_SEC = 0.05;

/** Monotonic clock: unaffected by system clock changes, and the same source for every engine event. */
function readNowMs(): number {
  return globalThis.performance.now();
}

/** Ticks arrive several times a second; only re-render when something the UI shows changed. */
function keepViewIfUnchanged(current: EngineView, next: EngineView): EngineView {
  const isSame = current.statuses === next.statuses
    && current.openGroupId === next.openGroupId
    && current.enabled === next.enabled;
  return isSame ? current : next;
}

function toEngineView(state: { statuses: Readonly<Record<string, CheckpointStatus>>; openGroupId: string | null; enabled: boolean }): EngineView {
  return { statuses: state.statuses, openGroupId: state.openGroupId, enabled: state.enabled };
}

/**
 * Stops the player at the moments quiz questions point to, asks them as practice (no score),
 * and resumes. All timing decisions live in the pure engine; this hook only wires events,
 * runs the effects it returns and keeps the learner's answers.
 */
export function useMediaCheckpoints(options: UseMediaCheckpointsOptions): UseMediaCheckpointsResult {
  const { adapter, quizId, durationSec, focusMedia } = options;
  const quiz = useCheckpointQuiz(quizId);
  const progress = useCheckpointProgress(quizId);
  const [measuredDurationSec, setMeasuredDurationSec] = useState<number | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Readonly<Record<string, string | null>>>({});
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const practice = usePracticeFeedback({ answers: selectedOptions });
  const { loadPracticeFeedback } = practice;
  // `usePracticeFeedback` returns new function identities every render; keep them out of effect deps.
  const resetFeedbackRef = useRef(practice.resetQuestionFeedback);

  const effectiveDurationSec = durationSec ?? measuredDurationSec;
  const groups = useMemo<readonly CheckpointGroup[]>(
    () => buildCheckpointGroups(quiz.questions, { durationSec: effectiveDurationSec }),
    [quiz.questions, effectiveDurationSec],
  );
  const questionsById = useMemo(
    () => new Map(quiz.questions.map((question) => [question.id, question])),
    [quiz.questions],
  );

  const answered = useMemo<CheckpointAnswerMap>(() => {
    const fromFeedback: Record<string, boolean> = {};
    for (const [questionId, state] of Object.entries(practice.feedbackByQuestionId)) {
      if (state.status === "ready" && state.response) fromFeedback[questionId] = state.response.isCorrect;
    }
    return { ...progress.restored, ...fromFeedback };
  }, [practice.feedbackByQuestionId, progress.restored]);

  const [initialEngine] = useState(() => createCheckpointEngine({ groups: [], enabled: true, emitsSeekEvents: adapter.emitsSeekEvents }));
  const engineRef = useRef(initialEngine);
  const [engineView, setEngineView] = useState<EngineView>(() => toEngineView(initialEngine));
  const groupsRef = useRef(groups);
  const answeredRef = useRef(answered);
  const dispatchRef = useRef<(event: CheckpointEngineEvent) => void>(() => undefined);
  const feedbackRef = useRef(practice.feedbackByQuestionId);
  const selectedRef = useRef(selectedOptions);
  const activeQuestionRef = useRef(activeQuestionId);
  const resumingRef = useRef(false);
  const frameRef = useRef(0);
  const startFrameLoopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    groupsRef.current = groups;
    answeredRef.current = answered;
    feedbackRef.current = practice.feedbackByQuestionId;
    selectedRef.current = selectedOptions;
    activeQuestionRef.current = activeQuestionId;
    resetFeedbackRef.current = practice.resetQuestionFeedback;
  }, [groups, answered, practice.feedbackByQuestionId, practice.resetQuestionFeedback, selectedOptions, activeQuestionId]);

  /** A check that is still loading when its question closes must not mark it answered later. */
  const cancelPendingFeedback = useCallback((): void => {
    const questionId = activeQuestionRef.current;
    if (questionId === null) return;
    if (feedbackRef.current[questionId]?.status !== "loading") return;
    resetFeedbackRef.current(questionId, selectedRef.current[questionId] ?? "");
  }, []);

  const runEffect = useCallback((effect: CheckpointEngineEffect): void => {
    if (effect === null) return;
    if (effect.type === "PAUSE") {
      adapter.pause();
      dispatchRef.current({ type: "PAUSED_AT", timeSec: adapter.getCurrentTime() });
    }
    if (effect.type === "PAUSE" || effect.type === "OPEN_NEXT") {
      const group = groupsRef.current.find((candidate) => candidate.id === effect.groupId);
      const nextQuestionId = findNextUnansweredQuestionId(group, answeredRef.current);
      if (nextQuestionId === null) {
        // Nothing left to ask (already answered elsewhere): never show an empty panel.
        dispatchRef.current({ type: "RESOLVE", groupId: effect.groupId, outcome: "answered" });
        return;
      }
      setActiveQuestionId(nextQuestionId);
      return;
    }
    cancelPendingFeedback();
    setActiveQuestionId(null);
    if (Math.abs(adapter.getCurrentTime() - effect.timeSec) > RESUME_SEEK_TOLERANCE_SEC) adapter.seekTo(effect.timeSec);
    const mediaDurationSec = adapter.getDuration();
    const isAtEnd = mediaDurationSec !== null && effect.timeSec >= mediaDurationSec - RESUME_SEEK_TOLERANCE_SEC;
    if (!isAtEnd) {
      resumingRef.current = true;
      // A player may refuse to start (autoplay policy): the viewer then presses play themselves.
      void adapter.play().catch(() => undefined).finally(() => { resumingRef.current = false; });
    }
    focusMedia?.();
  }, [adapter, cancelPendingFeedback, focusMedia]);

  const dispatchEngine = useCallback((event: CheckpointEngineEvent): void => {
    const result = reduceCheckpointEngine(engineRef.current, event);
    engineRef.current = result.state;
    setEngineView((current) => keepViewIfUnchanged(current, toEngineView(result.state)));
    runEffect(result.effect);
  }, [runEffect]);

  useEffect(() => {
    dispatchRef.current = dispatchEngine;
  }, [dispatchEngine]);

  // Groups change when the quiz or the media length arrives; saved answers are applied first.
  const hasGroups = groups.length > 0;
  useEffect(() => {
    if (!progress.isRestored || !hasGroups) return;
    // Dispatch through the ref: this effect must re-run only when the groups change, never per render.
    dispatchRef.current({ type: "GROUPS_CHANGED", groups });
    dispatchRef.current({ type: "RESTORE_ANSWERED", groupIds: findAnsweredGroupIds(groups, answeredRef.current) });
  }, [groups, hasGroups, progress.isRestored]);

  const { persist } = progress;
  useEffect(() => {
    if (progress.isRestored && Object.keys(answered).length > 0) persist(answered);
  }, [answered, persist, progress.isRestored]);

  // Per-frame polling only in the last second before a stop, so the pause lands on the frame.
  useEffect(() => {
    const runFrame = (): void => {
      frameRef.current = 0;
      const timeSec = adapter.getCurrentTime();
      if (adapter.isPaused() || adapter.isSwapPending() || !isNearCheckpoint(engineRef.current, timeSec)) return;
      dispatchRef.current({ type: "TICK", timeSec, nowMs: readNowMs(), playbackRate: adapter.getPlaybackRate(), isPaused: false });
      if (isNearCheckpoint(engineRef.current, adapter.getCurrentTime())) frameRef.current = globalThis.requestAnimationFrame(runFrame);
    };
    startFrameLoopRef.current = (): void => {
      if (frameRef.current === 0) frameRef.current = globalThis.requestAnimationFrame(runFrame);
    };
    return () => {
      globalThis.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [adapter]);

  useEffect(() => adapter.subscribe((event) => {
    switch (event.type) {
      case "time": {
        const mediaDurationSec = adapter.getDuration();
        if (mediaDurationSec !== null) setMeasuredDurationSec((current) => current ?? mediaDurationSec);
        dispatchRef.current({
          type: "TICK",
          timeSec: event.timeSec,
          nowMs: readNowMs(),
          playbackRate: adapter.getPlaybackRate(),
          isPaused: adapter.isPaused(),
        });
        if (isNearCheckpoint(engineRef.current, event.timeSec)) startFrameLoopRef.current();
        return;
      }
      case "seeked":
        dispatchRef.current({ type: "SEEKED", timeSec: event.timeSec, nowMs: readNowMs() });
        return;
      case "ended":
        dispatchRef.current({ type: "ENDED", timeSec: event.timeSec });
        return;
      case "play": {
        const openGroupId = engineRef.current.openGroupId;
        if (openGroupId !== null && !resumingRef.current) {
          const group = groupsRef.current.find((candidate) => candidate.id === openGroupId);
          dispatchRef.current({ type: "RESOLVE", groupId: openGroupId, outcome: decideNativePlayOutcome(group, answeredRef.current) });
        }
        dispatchRef.current({ type: "PLAYED", nowMs: readNowMs() });
        return;
      }
      case "pause":
        return;
    }
  }), [adapter]);

  const setPauseEnabled = useCallback((isEnabled: boolean): void => {
    dispatchEngine({ type: "SET_ENABLED", enabled: isEnabled });
  }, [dispatchEngine]);

  const selectOption = useCallback((optionId: string): void => {
    if (activeQuestionId === null) return;
    if (practice.feedbackByQuestionId[activeQuestionId]?.status === "ready") return;
    setSelectedOptions((current) => ({ ...current, [activeQuestionId]: optionId }));
    practice.resetQuestionFeedback(activeQuestionId, optionId);
  }, [activeQuestionId, practice]);

  const checkAnswer = useCallback((): void => {
    if (quizId === null || activeQuestionId === null) return;
    const optionId = selectedOptions[activeQuestionId];
    if (!optionId) return;
    void loadPracticeFeedback({ quizId, questionId: activeQuestionId, optionId });
  }, [activeQuestionId, loadPracticeFeedback, quizId, selectedOptions]);

  const skip = useCallback((): void => {
    const openGroupId = engineRef.current.openGroupId;
    if (openGroupId === null) return;
    dispatchEngine({ type: "RESOLVE", groupId: openGroupId, outcome: "skipped" });
  }, [dispatchEngine]);

  const advance = useCallback((): void => {
    const openGroupId = engineRef.current.openGroupId;
    if (openGroupId === null) return;
    const group = groupsRef.current.find((candidate) => candidate.id === openGroupId);
    const nextQuestionId = findNextUnansweredQuestionId(group, answeredRef.current, activeQuestionId);
    if (nextQuestionId !== null) {
      setActiveQuestionId(nextQuestionId);
      return;
    }
    dispatchEngine({ type: "RESOLVE", groupId: openGroupId, outcome: "answered" });
  }, [activeQuestionId, dispatchEngine]);

  const seekToSeconds = useCallback((timeSec: number): void => { adapter.seekTo(timeSec); }, [adapter]);

  const openCheckpoint = useMemo<OpenCheckpointView | null>(() => {
    if (engineView.openGroupId === null || activeQuestionId === null) return null;
    const group = groups.find((candidate) => candidate.id === engineView.openGroupId);
    const question = questionsById.get(activeQuestionId);
    if (!group || !question) return null;
    return {
      groupId: group.id,
      atSec: group.atSec,
      question,
      selectedOptionId: selectedOptions[question.id] ?? null,
      feedback: practice.feedbackByQuestionId[question.id] ?? null,
      isLastInGroup: group.questionIds.indexOf(question.id) === group.questionIds.length - 1,
    };
  }, [activeQuestionId, engineView.openGroupId, groups, practice.feedbackByQuestionId, questionsById, selectedOptions]);

  const items = useMemo<readonly CheckpointListItem[]>(
    () => groups.map((group) => ({ group, status: engineView.statuses[group.id] ?? "upcoming" })),
    [groups, engineView.statuses],
  );

  return {
    loadState: quiz.loadState,
    items,
    timedQuestionCount: quiz.questions.filter((question) => question.timeRange !== null).length,
    isPauseEnabled: engineView.enabled,
    openCheckpoint,
    retryLoad: quiz.retry,
    setPauseEnabled,
    selectOption,
    checkAnswer,
    advance,
    skip,
    seekToSeconds,
  };
}
