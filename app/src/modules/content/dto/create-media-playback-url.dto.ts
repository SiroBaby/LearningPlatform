import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { MEDIA_PLAYBACK_REASONS, type MediaPlaybackReason } from '../contracts/media-playback-policy';

export class CreateMediaPlaybackUrlDto {
  @ApiProperty({
    description: 'Why the client asks for a new playback URL. Used for diagnostics only.',
    enum: MEDIA_PLAYBACK_REASONS,
    example: 'INITIAL',
    required: false,
  })
  @IsOptional()
  @IsIn(MEDIA_PLAYBACK_REASONS)
  reason?: MediaPlaybackReason;
}
