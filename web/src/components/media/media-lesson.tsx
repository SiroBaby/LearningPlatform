"use client";

import { useCallback } from "react";

import { CheckpointList } from "./checkpoint-list";
import { CheckpointPanel } from "./checkpoint-panel";
import { MediaPlayer } from "./media-player";
import type { MediaPlayerKind } from "./media-player";
import { useMediaCheckpoints } from "./use-media-checkpoints";
import { useMediaPlayback } from "./use-media-playback";

interface MediaLessonProps {
  readonly documentId: string;
  readonly kind: MediaPlayerKind;
  readonly title: string;
  readonly durationSec: number | null;
  readonly initialStartSec?: number;
  /** Null while the quiz of this document is unknown or not ready: no questions are asked. */
  readonly quizId: string | null;
}

/** A video or audio lesson: the player plus questions that appear at the right moments. */
export function MediaLesson({ documentId, kind, title, durationSec, initialStartSec, quizId }: MediaLessonProps) {
  const playback = useMediaPlayback({ documentId, initialStartSec });
  const { mediaRef } = playback;
  const focusMedia = useCallback((): void => { mediaRef.current?.focus(); }, [mediaRef]);
  const checkpoints = useMediaCheckpoints({ adapter: playback.adapter, quizId, durationSec, focusMedia });
  const isSourceUnavailable = playback.errorKind !== null && !playback.canRetry;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <div className="min-w-0 space-y-4">
        <MediaPlayer playback={playback} kind={kind} title={title} />
        <CheckpointList items={checkpoints.items} kind={kind} onSeekAction={checkpoints.seekToSeconds} />
      </div>
      <CheckpointPanel
        kind={kind}
        quizId={quizId}
        checkpoints={checkpoints}
        isSourceUnavailable={isSourceUnavailable}
      />
    </div>
  );
}
