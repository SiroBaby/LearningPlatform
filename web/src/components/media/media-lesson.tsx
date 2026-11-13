"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";

import type { MediaPlayerAdapter } from "@/lib/media-playback/media-player-adapter";

import { CheckpointList } from "./checkpoint-list";
import { CheckpointPanel } from "./checkpoint-panel";
import { MediaPlayer } from "./media-player";
import type { MediaPlayerKind } from "./media-player";
import { useMediaCheckpoints } from "./use-media-checkpoints";
import { useMediaPlayback } from "./use-media-playback";
import { useYouTubePlayback } from "./use-youtube-playback";
import { YouTubePlayer } from "./youtube-player";

/** Where the lesson plays from: an uploaded file (signed URL) or a YouTube video. */
export type MediaLessonSource =
  | { readonly kind: "html"; readonly mediaKind: MediaPlayerKind }
  | { readonly kind: "youtube"; readonly videoId: string };

interface MediaLessonProps {
  readonly documentId: string;
  readonly source: MediaLessonSource;
  readonly title: string;
  readonly durationSec: number | null;
  readonly initialStartSec?: number;
  /** Null while the quiz of this document is unknown or not ready: no questions are asked. */
  readonly quizId: string | null;
}

interface LessonLayoutProps {
  readonly kind: MediaPlayerKind;
  readonly adapter: MediaPlayerAdapter;
  readonly focusMedia: () => void;
  readonly isSourceUnavailable: boolean;
  readonly quizId: string | null;
  readonly durationSec: number | null;
  readonly player: ReactNode;
}

/** The player plus questions that appear at the right moments; shared by every source. */
function LessonLayout({ kind, adapter, focusMedia, isSourceUnavailable, quizId, durationSec, player }: LessonLayoutProps) {
  const checkpoints = useMediaCheckpoints({ adapter, quizId, durationSec, focusMedia });

  return (
    // Desktop: two columns, two rows. The panel spans both rows and the second row takes the spare
    // height, so a tall question panel never pushes the checkpoint list away from the player.
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-[auto_1fr] lg:items-start">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{player}</div>
      <CheckpointPanel
        className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
        kind={kind}
        quizId={quizId}
        checkpoints={checkpoints}
        isSourceUnavailable={isSourceUnavailable}
      />
      {checkpoints.items.length > 0 ? (
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <CheckpointList items={checkpoints.items} kind={kind} onSeekAction={checkpoints.seekToSeconds} />
        </div>
      ) : null}
    </div>
  );
}

interface SourceLessonProps {
  readonly documentId: string;
  readonly title: string;
  readonly durationSec: number | null;
  readonly initialStartSec?: number;
  readonly quizId: string | null;
}

function HtmlMediaLesson({ documentId, mediaKind, title, durationSec, initialStartSec, quizId }: SourceLessonProps & { readonly mediaKind: MediaPlayerKind }) {
  const playback = useMediaPlayback({ documentId, initialStartSec });
  const { mediaRef } = playback;
  const focusMedia = useCallback((): void => { mediaRef.current?.focus(); }, [mediaRef]);
  const isSourceUnavailable = playback.errorKind !== null && !playback.canRetry;

  return (
    <LessonLayout
      kind={mediaKind}
      adapter={playback.adapter}
      focusMedia={focusMedia}
      isSourceUnavailable={isSourceUnavailable}
      quizId={quizId}
      durationSec={durationSec}
      player={<MediaPlayer playback={playback} kind={mediaKind} title={title} />}
    />
  );
}

function YouTubeLesson({ videoId, title, durationSec, initialStartSec, quizId }: SourceLessonProps & { readonly videoId: string }) {
  const playback = useYouTubePlayback({ videoId, title, initialStartSec });

  return (
    <LessonLayout
      kind="VIDEO"
      adapter={playback.adapter}
      focusMedia={playback.focusPlayer}
      isSourceUnavailable={playback.isSourceUnavailable}
      quizId={quizId}
      durationSec={durationSec}
      player={<YouTubePlayer playback={playback} />}
    />
  );
}

/** A video, audio or YouTube lesson. The source decides the player; the question flow is the same. */
export function MediaLesson({ documentId, source, title, durationSec, initialStartSec, quizId }: MediaLessonProps) {
  if (source.kind === "youtube") {
    return <YouTubeLesson documentId={documentId} videoId={source.videoId} title={title} durationSec={durationSec} initialStartSec={initialStartSec} quizId={quizId} />;
  }
  return <HtmlMediaLesson documentId={documentId} mediaKind={source.mediaKind} title={title} durationSec={durationSec} initialStartSec={initialStartSec} quizId={quizId} />;
}
