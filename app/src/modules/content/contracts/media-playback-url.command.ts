import type { MediaPlaybackReason } from './media-playback-policy';

export interface CreateMediaPlaybackUrlCommand {
  readonly ownerId: string;
  readonly documentId: string;
  readonly reason: MediaPlaybackReason;
}
