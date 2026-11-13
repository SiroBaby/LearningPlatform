import { AutoMap } from '@automapper/classes';
import { ApiProperty } from '@nestjs/swagger';

export class SubtitleCuePreviewResponseDto {
  @ApiProperty({ description: 'Cue start in seconds.', example: 1.5 })
  @AutoMap()
  readonly startSec: number;

  @ApiProperty({ description: 'Cue end in seconds.', example: 4.25 })
  @AutoMap()
  readonly endSec: number;

  @ApiProperty({ description: 'Plain text of the cue; markup is already removed.', example: 'Xin chào các bạn.' })
  @AutoMap()
  readonly text: string;
}

export class SubtitlePreviewResponseDto {
  @ApiProperty({ enum: ['VTT', 'SRT'], example: 'VTT' })
  @AutoMap()
  readonly format: 'VTT' | 'SRT';

  @ApiProperty({ example: 120 })
  @AutoMap()
  readonly cueCount: number;

  @ApiProperty({ description: 'Total characters (code points) across every cue.', example: 5400 })
  @AutoMap()
  readonly charCount: number;

  @ApiProperty({ description: 'Covered duration in seconds, rounded up.', example: 1800 })
  @AutoMap()
  readonly durationSec: number;

  @ApiProperty({ type: [SubtitleCuePreviewResponseDto] })
  @AutoMap(() => [SubtitleCuePreviewResponseDto])
  readonly cues: SubtitleCuePreviewResponseDto[];
}
