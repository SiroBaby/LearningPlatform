import { ApiProperty } from '@nestjs/swagger';
import { AutoMap } from '@automapper/classes';

export class MediaPlaybackUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived presigned URL for streaming the media source. Never log or persist it.',
    example: 'https://storage.example/media/owner/file.mp4?X-Amz-Expires=14400',
    format: 'uri',
  })
  @AutoMap()
  readonly url: string;

  @ApiProperty({ description: 'Instant the URL stops working, ISO-8601 UTC.', example: '2026-09-04T04:00:00.000Z' })
  readonly expiresAt: string;

  @ApiProperty({ description: 'Lifetime of the URL in seconds from issue time.', example: 14400, minimum: 1 })
  @AutoMap()
  readonly ttlSec: number;

  @ApiProperty({ enum: ['video/mp4', 'audio/mpeg'], example: 'video/mp4' })
  @AutoMap()
  readonly mimeType: 'video/mp4' | 'audio/mpeg';

  @ApiProperty({ description: 'Probed media duration in seconds, null when unknown.', example: 1800, nullable: true, type: Number })
  readonly durationSec: number | null;
}
