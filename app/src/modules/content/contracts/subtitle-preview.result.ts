import { AutoMap } from '@automapper/classes';

export class SubtitleCuePreviewResult {
  @AutoMap()
  startSec!: number;

  @AutoMap()
  endSec!: number;

  @AutoMap()
  text!: string;
}

export class SubtitlePreviewResult {
  @AutoMap()
  format!: 'VTT' | 'SRT';

  @AutoMap()
  cueCount!: number;

  @AutoMap()
  charCount!: number;

  @AutoMap()
  durationSec!: number;

  @AutoMap(() => [SubtitleCuePreviewResult])
  cues!: SubtitleCuePreviewResult[];
}
