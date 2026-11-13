/** Gives the embedded player a bounded time to report ready before the lesson shows a retry. */

export const YOUTUBE_READY_TIMEOUT_MS = 15_000;

export interface ReadyWatchdogTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReadyWatchdog {
  start(): void;
  /** Stops the countdown; safe to call at any time, including after it fired. */
  cancel(): void;
}

const browserTimers: ReadyWatchdogTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createReadyWatchdog(
  onTimeout: () => void,
  timers: ReadyWatchdogTimers = browserTimers,
  timeoutMs: number = YOUTUBE_READY_TIMEOUT_MS,
): ReadyWatchdog {
  let handle: unknown = null;
  const cancel = (): void => {
    if (handle === null) return;
    timers.clearTimeout(handle);
    handle = null;
  };
  return {
    start(): void {
      cancel();
      handle = timers.setTimeout(() => {
        handle = null;
        onTimeout();
      }, timeoutMs);
    },
    cancel,
  };
}
