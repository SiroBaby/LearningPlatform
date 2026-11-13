/**
 * Adapts a YouTube IFrame player to the player-agnostic `MediaPlayerAdapter`.
 * Pure (no React, no DOM): timers are injected so it runs against fakes in `node --test`.
 * One adapter lives for the whole lesson; the player is attached and detached under it, so
 * consumers keep a stable identity even when the player is remounted after an error.
 */

import type { MediaPlayerAdapter, MediaPlayerEvent, MediaPlayerEventListener } from "./media-player-adapter";

export const YOUTUBE_STATE_ENDED = 0;
export const YOUTUBE_STATE_PLAYING = 1;
export const YOUTUBE_STATE_PAUSED = 2;
export const YOUTUBE_TIME_POLL_MS = 250;
export const YOUTUBE_PLAY_TIMEOUT_MS = 1500;

/** The subset of the IFrame player the adapter reads and drives. */
export interface YouTubePlayerLike {
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

export interface YouTubeAdapterTimers {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface YouTubePlayerAdapter extends MediaPlayerAdapter {
  attachPlayer(player: YouTubePlayerLike): void;
  /** Forgets the player (remount or teardown): stops polling and fails any `play()` still waiting. */
  detachPlayer(): void;
  /** Feed every `onStateChange` state code here; states other than playing, paused and ended are ignored. */
  handleStateChange(state: number): void;
}

interface PendingPlay {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeoutHandle: unknown;
}

const browserTimers: YouTubeAdapterTimers = {
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function toFiniteSeconds(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function createYouTubePlayerAdapter(timers: YouTubeAdapterTimers = browserTimers): YouTubePlayerAdapter {
  const listeners = new Set<MediaPlayerEventListener>();
  const pendingPlays = new Set<PendingPlay>();
  let player: YouTubePlayerLike | null = null;
  let isPlaying = false;
  let pollHandle: unknown = null;

  const readCurrentTime = (): number => (player === null ? 0 : toFiniteSeconds(player.getCurrentTime()));

  function emit(event: MediaPlayerEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function stopPolling(): void {
    if (pollHandle === null) return;
    timers.clearInterval(pollHandle);
    pollHandle = null;
  }

  function startPolling(): void {
    if (pollHandle !== null) return;
    pollHandle = timers.setInterval(() => emit({ type: "time", timeSec: readCurrentTime() }), YOUTUBE_TIME_POLL_MS);
  }

  function settlePendingPlays(error: Error | null): void {
    for (const pending of [...pendingPlays]) {
      pendingPlays.delete(pending);
      timers.clearTimeout(pending.timeoutHandle);
      if (error === null) pending.resolve();
      else pending.reject(error);
    }
  }

  function handleStateChange(state: number): void {
    if (state === YOUTUBE_STATE_PLAYING) {
      isPlaying = true;
      // `play` is emitted before the waiting `play()` settles: a resume started by the checkpoint
      // controller is still marked as resuming while this event is handled.
      emit({ type: "play" });
      emit({ type: "time", timeSec: readCurrentTime() });
      startPolling();
      settlePendingPlays(null);
      return;
    }
    if (state === YOUTUBE_STATE_PAUSED) {
      isPlaying = false;
      stopPolling();
      emit({ type: "pause" });
      emit({ type: "time", timeSec: readCurrentTime() });
      return;
    }
    if (state === YOUTUBE_STATE_ENDED) {
      isPlaying = false;
      stopPolling();
      emit({ type: "ended", timeSec: readCurrentTime() });
    }
  }

  function play(): Promise<void> {
    if (player === null) return Promise.reject(new Error("YouTube player is not ready."));
    if (isPlaying) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeoutHandle = timers.setTimeout(() => {
        pendingPlays.delete(pending);
        reject(new Error("YouTube player did not start."));
      }, YOUTUBE_PLAY_TIMEOUT_MS);
      const pending: PendingPlay = { resolve, reject, timeoutHandle };
      pendingPlays.add(pending);
      player?.playVideo();
    });
  }

  function seekTo(timeSec: number): void {
    if (player === null || !Number.isFinite(timeSec) || timeSec < 0) return;
    player.seekTo(timeSec, true);
    // No seek event exists: tell listeners the new position now so the seek is inferred from this tick.
    emit({ type: "time", timeSec });
  }

  return {
    emitsSeekEvents: false,
    attachPlayer(nextPlayer: YouTubePlayerLike): void {
      player = nextPlayer;
    },
    detachPlayer(): void {
      stopPolling();
      isPlaying = false;
      player = null;
      settlePendingPlays(new Error("YouTube player was removed."));
    },
    handleStateChange,
    getCurrentTime: readCurrentTime,
    getDuration: (): number | null => {
      const duration = player?.getDuration();
      return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
    },
    getPlaybackRate: (): number => {
      const rate = player?.getPlaybackRate();
      return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
    },
    isPaused: (): boolean => !isPlaying,
    isSwapPending: (): boolean => false,
    play,
    pause(): void {
      if (player === null) return;
      player.pauseVideo();
      // Report paused right away; the player confirms with a paused state shortly after.
      isPlaying = false;
    },
    seekTo,
    subscribe(listener: MediaPlayerEventListener): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
