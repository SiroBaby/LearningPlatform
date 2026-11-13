export type SubtitleFormat = 'VTT' | 'SRT';

/** One timed line of a subtitle file, already sanitized to plain text. */
export interface SubtitleCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface ParsedSubtitle {
  readonly format: SubtitleFormat;
  readonly cues: readonly SubtitleCue[];
  readonly cueCount: number;
  /** Total code points across every cue text. */
  readonly charCount: number;
  /** Largest cue end, which is the covered media duration. */
  readonly durationMs: number;
}
