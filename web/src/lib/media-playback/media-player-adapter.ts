/**
 * Player-agnostic view of a media element. HTML media is the only implementation today;
 * a polling player (for example YouTube) can implement the same contract later.
 */

export type MediaPlayerEvent =
  | { readonly type: "time"; readonly timeSec: number }
  | { readonly type: "seeked"; readonly timeSec: number }
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "ended"; readonly timeSec: number };

export type MediaPlayerEventListener = (event: MediaPlayerEvent) => void;

export interface MediaPlayerAdapter {
  getCurrentTime(): number;
  /** Null until the length is known (and for live or unknown streams). */
  getDuration(): number | null;
  getPlaybackRate(): number;
  isPaused(): boolean;
  /** True while a source swap has not restored the viewer's place: positions read now are meaningless. */
  isSwapPending(): boolean;
  play(): Promise<void>;
  pause(): void;
  seekTo(timeSec: number): void;
  /** Subscribes to player events; returns the unsubscribe function. */
  subscribe(listener: MediaPlayerEventListener): () => void;
  /** HTML media fires `seeked`; a polling player does not, so seeks must be inferred from ticks. */
  readonly emitsSeekEvents: boolean;
}
