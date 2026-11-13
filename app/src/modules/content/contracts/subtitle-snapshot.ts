import type { SubtitleCue, SubtitleFormat } from '../subtitles/subtitle.types';

/** The parsed, owner-confirmed transcript that Go reads instead of the raw subtitle object. */
export interface SubtitleSnapshot {
  readonly charCount: number;
  readonly cueCount: number;
  readonly cues: readonly SubtitleCue[];
  readonly durationMs: number;
  readonly parserVersion: string;
  readonly sourceFormat: SubtitleFormat;
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type SubtitleSnapshotSaveOutcome = 'SAVED' | 'DOCUMENT_NOT_FOUND' | 'NOT_ALLOWED';

/** Why a YOUTUBE Document cannot start processing yet. */
export type SubtitlePrerequisite = 'PREVIEW_REQUIRED' | 'RIGHTS_REQUIRED';

export class SubtitlePrerequisiteError extends Error {
  constructor(readonly prerequisite: SubtitlePrerequisite) {
    super(prerequisite);
    this.name = 'SubtitlePrerequisiteError';
  }
}
