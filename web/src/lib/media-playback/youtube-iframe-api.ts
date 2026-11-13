/**
 * Loads the YouTube IFrame API once per page. The browser pieces are injected so the loader
 * can run against fakes in `node --test`; `loadYouTubeIframeApi` is the browser instance.
 */

export const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
export const YOUTUBE_IFRAME_API_TIMEOUT_MS = 10_000;

/** What the app needs from the global `YT` namespace; typed loosely on purpose. */
export interface YouTubeIframeApi {
  readonly Player: new (host: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerHandle;
}

export interface YouTubePlayerOptions {
  readonly host: string;
  readonly videoId: string;
  readonly width: string;
  readonly height: string;
  readonly playerVars: Readonly<Record<string, string | number>>;
  readonly events: {
    readonly onReady: () => void;
    readonly onStateChange: (event: { readonly data: number }) => void;
    readonly onError: (event: { readonly data: number }) => void;
  };
}

export interface YouTubePlayerHandle {
  getCurrentTime(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getPlayerState(): number;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

export interface YouTubeWindowLike {
  YT?: { Player?: unknown };
  onYouTubeIframeAPIReady?: () => void;
}

export interface YouTubeApiLoaderEnvironment {
  /** Undefined during server rendering. */
  getWindow(): YouTubeWindowLike | undefined;
  /** Adds the API script (or reuses one already on the page); returns a function that removes it again. */
  addScript(src: string, onError: () => void): () => void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type YouTubeApiLoader = () => Promise<YouTubeIframeApi>;

function readLoadedApi(win: YouTubeWindowLike): YouTubeIframeApi | null {
  const player = win.YT?.Player;
  return typeof player === "function" ? (win.YT as YouTubeIframeApi) : null;
}

/** Returns a loader whose promise is shared by every caller and resets after a failure so a retry can run. */
export function createYouTubeApiLoader(
  environment: YouTubeApiLoaderEnvironment,
  timeoutMs: number = YOUTUBE_IFRAME_API_TIMEOUT_MS,
): YouTubeApiLoader {
  let pending: Promise<YouTubeIframeApi> | null = null;

  function startLoading(win: YouTubeWindowLike): Promise<YouTubeIframeApi> {
    return new Promise<YouTubeIframeApi>((resolve, reject) => {
      let isSettled = false;
      let removeScript: () => void = () => undefined;
      const previousReady = win.onYouTubeIframeAPIReady;
      const timeoutHandle = environment.setTimeout(() => fail(), timeoutMs);

      function finish(callback: () => void): void {
        if (isSettled) return;
        isSettled = true;
        environment.clearTimeout(timeoutHandle);
        callback();
      }
      function fail(): void {
        finish(() => {
          pending = null;
          removeScript();
          reject(new Error("YouTube IFrame API failed to load."));
        });
      }
      win.onYouTubeIframeAPIReady = (): void => {
        // Chain, never replace: another consumer may already wait for the same callback.
        previousReady?.();
        const api = readLoadedApi(win);
        if (api === null) return fail();
        finish(() => resolve(api));
      };
      removeScript = environment.addScript(YOUTUBE_IFRAME_API_URL, fail);
    });
  }

  return function loadApi(): Promise<YouTubeIframeApi> {
    const win = environment.getWindow();
    if (win === undefined) return Promise.reject(new Error("YouTube IFrame API needs a browser."));
    const loaded = readLoadedApi(win);
    if (loaded !== null) return Promise.resolve(loaded);
    pending ??= startLoading(win);
    return pending;
  };
}

function addBrowserScript(src: string, onError: () => void): () => void {
  const existing = Array.from(document.getElementsByTagName("script")).find((script) => script.src === src);
  if (existing !== undefined) return () => undefined;
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  script.addEventListener("error", onError, { once: true });
  document.head.appendChild(script);
  return () => script.remove();
}

const browserEnvironment: YouTubeApiLoaderEnvironment = {
  getWindow: () => (typeof window === "undefined" ? undefined : (window as unknown as YouTubeWindowLike)),
  addScript: addBrowserScript,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const loadYouTubeIframeApi: YouTubeApiLoader = createYouTubeApiLoader(browserEnvironment);
