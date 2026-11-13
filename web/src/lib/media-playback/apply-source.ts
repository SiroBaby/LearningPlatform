/**
 * Swaps the URL of a live media element without remounting it, keeping the viewer's place.
 * Pure DOM-contract code (no React) so it can run against a fake element in `node --test`.
 */

export interface MediaElementLike {
  src: string;
  currentTime: number;
  playbackRate: number;
  defaultPlaybackRate: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** What a not-yet-restored swap still owes the viewer; seeds the next swap if this one is superseded. */
export interface PendingSourceSnapshot {
  readonly timeSec: number;
  readonly wasPlaying: boolean;
  readonly playbackRate: number;
}

export interface ApplySourceOptions {
  readonly url: string;
  /** Position to start from when the element has not played this media yet. */
  readonly startSec?: number;
  /** Force resume (true) or stay paused (false); inferred from the element when omitted. */
  readonly resumePlayback?: boolean;
  /** Snapshot of a superseded, still-pending swap: the element was already reset by its load. */
  readonly seed?: PendingSourceSnapshot | null;
  /** Called when a resume was wanted but the browser refused to play (autoplay policy). */
  readonly onPlayRejected?: () => void;
}

export interface AppliedSourceHandle {
  /** Stops a pending restore, used when a newer source supersedes this one. */
  cancel(): void;
  /** Null once the position has been restored (or the swap cancelled). */
  getPendingSnapshot(): PendingSourceSnapshot | null;
  isPending(): boolean;
}

const MIN_PLAYBACK_RATE = 0.0625;

function readSafeRate(rate: number): number {
  return Number.isFinite(rate) && rate >= MIN_PLAYBACK_RATE ? rate : 1;
}

function readSafeTime(timeSec: number): number {
  return Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0;
}

export function applySource(element: MediaElementLike, options: ApplySourceOptions): AppliedSourceHandle {
  const seed = options.seed ?? null;
  const hasPlayedBefore = element.src !== "";
  const lastKnownTime = seed
    ? seed.timeSec
    : hasPlayedBefore ? readSafeTime(element.currentTime) : readSafeTime(options.startSec ?? 0);
  const wasPlaying = seed
    ? seed.wasPlaying || options.resumePlayback === true
    : options.resumePlayback ?? (hasPlayedBefore && !element.paused);
  const playbackRate = seed
    ? seed.playbackRate
    : readSafeRate(hasPlayedBefore ? element.playbackRate : element.defaultPlaybackRate);
  let isRestored = false;

  const restore = (): void => {
    if (isRestored) return;
    isRestored = true;
    element.removeEventListener("loadedmetadata", restore);
    element.removeEventListener("canplay", restore);
    if (lastKnownTime > 0) element.currentTime = lastKnownTime;
    element.playbackRate = playbackRate;
    if (!wasPlaying) return;
    try {
      void Promise.resolve(element.play()).catch(() => options.onPlayRejected?.());
    } catch {
      options.onPlayRejected?.();
    }
  };

  element.defaultPlaybackRate = playbackRate;
  element.addEventListener("loadedmetadata", restore);
  element.addEventListener("canplay", restore);
  element.src = options.url;

  return {
    cancel: (): void => {
      isRestored = true;
      element.removeEventListener("loadedmetadata", restore);
      element.removeEventListener("canplay", restore);
    },
    getPendingSnapshot: (): PendingSourceSnapshot | null =>
      isRestored ? null : { timeSec: lastKnownTime, wasPlaying, playbackRate },
    isPending: (): boolean => !isRestored,
  };
}
