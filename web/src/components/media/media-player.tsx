"use client";

import { useCallback } from "react";
import type { ReactNode } from "react";

import { Button, LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";

import { useMediaPlayback } from "./use-media-playback";

export type MediaPlayerKind = "VIDEO" | "AUDIO";

interface MediaPlayerProps {
  readonly documentId: string;
  readonly kind: MediaPlayerKind;
  readonly title: string;
  readonly initialStartSec?: number;
  readonly children?: ReactNode;
}

const LOADING_MESSAGE = "Đang tải nội dung…";
const RETRY_LABEL = "Thử lại";

export function MediaPlayer({ documentId, kind, title, initialStartSec, children }: MediaPlayerProps) {
  const playback = useMediaPlayback({ documentId, initialStartSec });
  const { mediaRef } = playback;
  const setVideoElement = useCallback((element: HTMLVideoElement | null): void => { mediaRef.current = element; }, [mediaRef]);
  const setAudioElement = useCallback((element: HTMLAudioElement | null): void => { mediaRef.current = element; }, [mediaRef]);

  const isLoading = playback.phase === "loading" || (playback.phase === "retry-wait" && !playback.hasSource);
  const isUnauthorized = playback.errorKind === "unauthorized";
  const retryLabel = playback.retryAvailableInSec > 0
    ? `Thử lại sau ${playback.retryAvailableInSec} giây`
    : RETRY_LABEL;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-ink-900" aria-busy={isLoading}>
        {kind === "VIDEO" ? (
          <video
            ref={setVideoElement}
            className="aspect-video w-full bg-black"
            controls
            playsInline
            preload="metadata"
            aria-label={title}
          />
        ) : (
          <audio ref={setAudioElement} className="block w-full" controls preload="metadata" aria-label={title} />
        )}

        {isLoading ? (
          <div className="absolute inset-0 flex animate-pulse items-center justify-center bg-ink-900/80 text-sm text-white" role="status">
            {LOADING_MESSAGE}
          </div>
        ) : null}

        {playback.errorMessage ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900/90 p-4 text-center text-sm text-white"
            role="alert"
          >
            <p>{playback.errorMessage}</p>
            {isUnauthorized ? <LinkButton href={routes.login} variant="outline">Đăng nhập</LinkButton> : null}
            {playback.canRetry ? (
              <Button type="button" variant="outline" onClick={playback.retry} disabled={playback.retryAvailableInSec > 0}>
                {retryLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
