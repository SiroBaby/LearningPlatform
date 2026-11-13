"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { applySource } from "@/lib/media-playback/apply-source";
import type { AppliedSourceHandle, MediaElementLike } from "@/lib/media-playback/apply-source";
import {
  computeRetryAvailableInSec,
  computeScheduledRefreshDelayMs,
  getPlaybackFailureMessage,
  initialPlaybackState,
  isFatalPlaybackFailure,
  isRefreshDue,
  isTooCloseToExpiryForPlay,
  playbackReducer,
} from "@/lib/media-playback/playback-refresh-policy";
import type { PlaybackEvent, PlaybackFailureKind, PlaybackPhase, PlaybackState } from "@/lib/media-playback/playback-refresh-policy";
import { Phase0ClientError, createPhase0PlaybackUrl } from "@/lib/phase0/client";
import type { Phase0PlaybackReason } from "@/lib/phase0/contracts";

const COUNTDOWN_TICK_MS = 1000;
const MAX_MEDIA_RECOVERIES_PER_SOURCE = 1;

export interface UseMediaPlaybackOptions {
  readonly documentId: string;
  readonly initialStartSec?: number;
}

export interface UseMediaPlaybackResult {
  readonly mediaRef: RefObject<HTMLMediaElement | null>;
  readonly phase: PlaybackPhase;
  /** True once a URL has been applied; the element keeps playing it through silent refreshes. */
  readonly hasSource: boolean;
  readonly errorKind: PlaybackFailureKind | null;
  readonly errorMessage: string | null;
  readonly canRetry: boolean;
  readonly retryAvailableInSec: number;
  retry(): void;
  play(): Promise<void>;
  pause(): void;
  seekTo(timeSec: number): void;
  getCurrentTime(): number;
  /** Subscribes to playback position updates; returns the unsubscribe function. */
  onTimeUpdate(listener: (timeSec: number) => void): () => void;
}

interface FetchOptions {
  readonly resumePlayback?: boolean;
}

function toFailureInput(error: unknown): { status: number; retryAfterSec?: number } {
  if (error instanceof Phase0ClientError) {
    return { status: error.status, retryAfterSec: error.retryAfterSec };
  }
  return { status: 0 };
}

/**
 * Keeps one media element playing from a presigned URL that is renewed in the background.
 * The element is never remounted; its `src` is swapped imperatively so position, rate and
 * play state survive every refresh. Reusable by any feature that needs the same element.
 */
export function useMediaPlayback(options: UseMediaPlaybackOptions): UseMediaPlaybackResult {
  const { documentId, initialStartSec } = options;
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [state, setState] = useState<PlaybackState>(initialPlaybackState);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const stateRef = useRef<PlaybackState>(initialPlaybackState);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedRef = useRef<AppliedSourceHandle | null>(null);
  const reasonRef = useRef<Phase0PlaybackReason>("INITIAL");
  const recoveriesRef = useRef(0);
  const startSecRef = useRef<number | undefined>(initialStartSec);
  const isMountedRef = useRef(false);
  const timeListenersRef = useRef<Set<(timeSec: number) => void>>(new Set());
  const fetchPlaybackRef = useRef<(reason: Phase0PlaybackReason, fetchOptions?: FetchOptions) => Promise<void>>(
    () => Promise.resolve(),
  );

  const dispatchEvent = useCallback((event: PlaybackEvent): void => {
    stateRef.current = playbackReducer(stateRef.current, event);
    if (isMountedRef.current) setState(stateRef.current);
  }, []);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleNext = useCallback((): void => {
    clearTimer();
    const current = stateRef.current;
    const now = Date.now();
    if (current.phase === "retry-wait" && current.retryAtMs !== null) {
      timerRef.current = globalThis.setTimeout(
        () => { void fetchPlaybackRef.current(reasonRef.current); },
        Math.max(0, current.retryAtMs - now),
      );
      return;
    }
    if (current.phase !== "ready") return;
    const delayMs = computeScheduledRefreshDelayMs(current, now);
    if (delayMs === null) return;
    timerRef.current = globalThis.setTimeout(
      () => { void fetchPlaybackRef.current("SCHEDULED_REFRESH"); },
      delayMs,
    );
  }, [clearTimer]);

  const fetchPlayback = useCallback((reason: Phase0PlaybackReason, fetchOptions: FetchOptions = {}): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const abortController = new AbortController();
    abortRef.current = abortController;
    reasonRef.current = reason;
    clearTimer();
    dispatchEvent({ type: "REQUEST_STARTED" });
    const run = async (): Promise<void> => {
      try {
        const response = await createPhase0PlaybackUrl(documentId, reason, abortController.signal);
        if (abortController.signal.aborted) return;
        dispatchEvent({ type: "REQUEST_SUCCEEDED", receivedAtMs: Date.now(), ttlSec: response.ttlSec });
        const element = mediaRef.current;
        if (element) {
          appliedRef.current?.cancel();
          appliedRef.current = applySource(element as MediaElementLike, {
            url: response.url,
            startSec: startSecRef.current,
            resumePlayback: fetchOptions.resumePlayback,
          });
          startSecRef.current = undefined;
        }
      } catch (error: unknown) {
        if (abortController.signal.aborted) return;
        dispatchEvent({ type: "REQUEST_FAILED", nowMs: Date.now(), failure: toFailureInput(error) });
      } finally {
        inFlightRef.current = null;
        if (!abortController.signal.aborted) scheduleNext();
      }
    };
    inFlightRef.current = run();
    return inFlightRef.current;
  }, [clearTimer, dispatchEvent, documentId, scheduleNext]);

  useEffect(() => {
    fetchPlaybackRef.current = fetchPlayback;
  }, [fetchPlayback]);

  const refreshIfDue = useCallback((reason: Phase0PlaybackReason): void => {
    const current = stateRef.current;
    const isBusy = current.phase === "loading" || current.phase === "refreshing";
    if (!current.hasSource || isBusy || !isRefreshDue(current.deadlineMs, Date.now())) return;
    void fetchPlayback(reason);
  }, [fetchPlayback]);

  // Initial fetch, and a clean teardown that survives React StrictMode's double mount.
  useEffect(() => {
    isMountedRef.current = true;
    startSecRef.current = initialStartSec;
    stateRef.current = initialPlaybackState;
    void fetchPlayback("INITIAL");
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      inFlightRef.current = null;
      appliedRef.current?.cancel();
      appliedRef.current = null;
      clearTimer();
    };
    // initialStartSec only seeds the first source; changing it must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Wake-ups: a throttled timer cannot be trusted after the tab was hidden or offline.
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") refreshIfDue("FOREGROUND");
    };
    const onOnline = (): void => {
      const current = stateRef.current;
      const canAutoRecover = current.phase === "error"
        && current.failureKind !== null
        && !isFatalPlaybackFailure(current.failureKind);
      if (canAutoRecover && computeRetryAvailableInSec(current, Date.now()) === 0) {
        dispatchEvent({ type: "MANUAL_RETRY", nowMs: Date.now() });
        void fetchPlayback("MANUAL_RETRY");
        return;
      }
      refreshIfDue("FOREGROUND");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener("online", onOnline);
    };
  }, [dispatchEvent, fetchPlayback, refreshIfDue]);

  // Element events: guard play near expiry, recover once from a media error, fan out time updates.
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return undefined;
    const onPlay = (): void => {
      const current = stateRef.current;
      if (!current.hasSource || !isTooCloseToExpiryForPlay(current.deadlineMs, Date.now())) return;
      element.pause();
      void fetchPlayback("EXPIRED", { resumePlayback: true });
    };
    const onPlaying = (): void => { recoveriesRef.current = 0; };
    const onError = (): void => {
      if (element.getAttribute("src") === null || stateRef.current.phase === "loading") return;
      if (recoveriesRef.current < MAX_MEDIA_RECOVERIES_PER_SOURCE) {
        recoveriesRef.current += 1;
        void fetchPlayback("EXPIRED", { resumePlayback: !element.paused });
        return;
      }
      dispatchEvent({ type: "SOURCE_FAILED", nowMs: Date.now() });
    };
    const onTimeUpdate = (): void => {
      for (const listener of timeListenersRef.current) listener(element.currentTime);
    };
    element.addEventListener("play", onPlay);
    element.addEventListener("playing", onPlaying);
    element.addEventListener("error", onError);
    element.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      element.removeEventListener("play", onPlay);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("error", onError);
      element.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [dispatchEvent, documentId, fetchPlayback]);

  // Countdown for the "Thử lại sau N giây" label; ticks only while a cooldown is visible.
  const isCoolingDown = state.phase === "error" && computeRetryAvailableInSec(state, nowMs) > 0;
  useEffect(() => {
    if (!isCoolingDown) return undefined;
    const intervalId = globalThis.setInterval(() => setNowMs(Date.now()), COUNTDOWN_TICK_MS);
    return () => globalThis.clearInterval(intervalId);
  }, [isCoolingDown]);

  const retry = useCallback((): void => {
    const before = stateRef.current;
    dispatchEvent({ type: "MANUAL_RETRY", nowMs: Date.now() });
    if (stateRef.current !== before) void fetchPlayback("MANUAL_RETRY");
  }, [dispatchEvent, fetchPlayback]);

  const play = useCallback(async (): Promise<void> => {
    const element = mediaRef.current;
    if (!element) return;
    const current = stateRef.current;
    if (current.hasSource && isTooCloseToExpiryForPlay(current.deadlineMs, Date.now())) {
      element.pause();
      await fetchPlayback("EXPIRED", { resumePlayback: true });
      return;
    }
    try {
      await element.play();
    } catch {
      // Autoplay or interruption: the viewer can press play again.
    }
  }, [fetchPlayback]);

  const pause = useCallback((): void => { mediaRef.current?.pause(); }, []);

  const seekTo = useCallback((timeSec: number): void => {
    if (!Number.isFinite(timeSec) || timeSec < 0) return;
    const element = mediaRef.current;
    if (element && element.getAttribute("src") !== null) element.currentTime = timeSec;
    else startSecRef.current = timeSec;
  }, []);

  const getCurrentTime = useCallback((): number => mediaRef.current?.currentTime ?? 0, []);

  const onTimeUpdate = useCallback((listener: (timeSec: number) => void): (() => void) => {
    timeListenersRef.current.add(listener);
    return () => { timeListenersRef.current.delete(listener); };
  }, []);

  const failureKind = state.failureKind;
  const isErrorVisible = state.phase === "error" && failureKind !== null;
  const canRetry = isErrorVisible && failureKind !== null && !isFatalPlaybackFailure(failureKind);

  return {
    mediaRef,
    phase: state.phase,
    hasSource: state.hasSource,
    errorKind: isErrorVisible ? failureKind : null,
    errorMessage: isErrorVisible && failureKind !== null ? getPlaybackFailureMessage(failureKind) : null,
    canRetry,
    retryAvailableInSec: isErrorVisible ? computeRetryAvailableInSec(state, nowMs) : 0,
    retry,
    play,
    pause,
    seekTo,
    getCurrentTime,
    onTimeUpdate,
  };
}
