"use client";

import { Button } from "@/components/ui";

import type { UseYouTubePlaybackResult } from "./use-youtube-playback";

interface YouTubePlayerProps {
  /** State and controls from `useYouTubePlayback`; this component only renders them. */
  readonly playback: UseYouTubePlaybackResult;
}

const LOADING_MESSAGE = "Đang tải video…";
const RETRY_LABEL = "Thử lại";

export function YouTubePlayer({ playback }: YouTubePlayerProps) {
  const { hostRef } = playback;
  const isLoading = playback.phase === "loading";
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink-900" aria-busy={isLoading}>
        <div ref={hostRef} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />

        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 flex animate-pulse items-center justify-center bg-ink-900/80 text-sm text-white" role="status">
            {LOADING_MESSAGE}
          </div>
        ) : null}

        {playback.errorMessage ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900/90 p-4 text-center text-sm text-white">
            <p role="alert">{playback.errorMessage}</p>
            {playback.canRetry ? (
              <Button type="button" variant="outline" onClick={playback.retry}>{RETRY_LABEL}</Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
