import { AutoMap } from '@automapper/classes';

export class MediaPlaybackUrlResult {
  @AutoMap()
  url!: string;

  expiresAt!: Date;

  @AutoMap()
  ttlSec!: number;

  @AutoMap()
  mimeType!: 'video/mp4' | 'audio/mpeg';

  durationSec!: number | null;
}
