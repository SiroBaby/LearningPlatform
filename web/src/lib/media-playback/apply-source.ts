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

export interface ApplySourceOptions {
  readonly url: string;
  /** Position to start from when the element has not played this media yet. */
  readonly startSec?: number;
  /** Force resume (true) or stay paused (false); inferred from the element when omitted. */
  readonly resumePlayback?: boolean;
}

export interface AppliedSourceHandle {
  /** Stops a pending restore, used when a newer source supersedes this one. */
  cancel(): void;
}

const MIN_PLAYBACK_RATE = 0.0625;

function readSafeRate(rate: number): number {
  return Number.isFinite(rate) && rate >= MIN_PLAYBACK_RATE ? rate : 1;
}

function readSafeTime(timeSec: number): number {
  return Number.isFinite(timeSec) && timeSec > 0 ? timeSec : 0;
}

export function applySource(element: MediaElementLike, options: ApplySourceOptions): AppliedSourceHandle {
  const hasPlayedBefore = element.src !== "";
  const lastKnownTime = hasPlayedBefore ? readSafeTime(element.currentTime) : readSafeTime(options.startSec ?? 0);
  const wasPlaying = options.resumePlayback ?? (hasPlayedBefore && !element.paused);
  const playbackRate = readSafeRate(hasPlayedBefore ? element.playbackRate : element.defaultPlaybackRate);
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
      void Promise.resolve(element.play()).catch(() => undefined);
    } catch {
      // Autoplay policy can throw synchronously in old engines; the viewer can press play.
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
  };
}
