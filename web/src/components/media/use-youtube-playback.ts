"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { MediaPlayerAdapter } from "@/lib/media-playback/media-player-adapter";
import { loadYouTubeIframeApi } from "@/lib/media-playback/youtube-iframe-api";
import type { YouTubePlayerHandle } from "@/lib/media-playback/youtube-iframe-api";
import { createYouTubePlayerAdapter } from "@/lib/media-playback/youtube-player-adapter";
import type { YouTubePlayerAdapter } from "@/lib/media-playback/youtube-player-adapter";
import {
  canRetryYouTubePlayback,
  classifyYouTubeErrorCode,
  getYouTubePlaybackErrorMessage,
} from "@/lib/media-playback/youtube-playback-errors";
import type { YouTubePlaybackErrorKind } from "@/lib/media-playback/youtube-playback-errors";

const YOUTUBE_NOCOOKIE_HOST = "https://www.youtube-nocookie.com";

export interface UseYouTubePlaybackOptions {
  readonly videoId: string;
  /** Accessible name of the embedded player. */
  readonly title: string;
  readonly initialStartSec?: number;
}

export interface UseYouTubePlaybackResult {
  /** Empty element the player is created in; React never renders children into it. */
  readonly hostRef: RefObject<HTMLDivElement | null>;
  /** One adapter for the whole lesson: its identity never changes, even across a remount after an error. */
  readonly adapter: MediaPlayerAdapter;
  readonly phase: "loading" | "ready" | "error";
  readonly errorKind: YouTubePlaybackErrorKind | null;
  readonly errorMessage: string | null;
  /** The video can never play (removed, private, not embeddable): only the quiz remains. */
  readonly isSourceUnavailable: boolean;
  readonly canRetry: boolean;
  retry(): void;
  /** Returns keyboard focus to the player after a question closes. */
  focusPlayer(): void;
}

interface PlaybackView {
  readonly phase: "loading" | "ready" | "error";
  readonly errorKind: YouTubePlaybackErrorKind | null;
}

const LOADING_VIEW: PlaybackView = { phase: "loading", errorKind: null };
const READY_VIEW: PlaybackView = { phase: "ready", errorKind: null };

function toErrorView(errorKind: YouTubePlaybackErrorKind): PlaybackView {
  return { phase: "error", errorKind };
}

function buildPlayerVars(initialStartSec: number | undefined): Record<string, string | number> {
  const playerVars: Record<string, string | number> = {
    playsinline: 1,
    rel: 0,
    origin: window.location.origin,
  };
  if (initialStartSec !== undefined && Number.isFinite(initialStartSec) && initialStartSec >= 1) {
    playerVars.start = Math.floor(initialStartSec);
  }
  return playerVars;
}

/**
 * Creates a YouTube player inside `hostRef` and feeds its events to one stable adapter.
 * The effect depends only on the video and the retry counter; everything else is read through refs.
 */
export function useYouTubePlayback(options: UseYouTubePlaybackOptions): UseYouTubePlaybackResult {
  const { videoId, title, initialStartSec } = options;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [adapter] = useState<YouTubePlayerAdapter>(() => createYouTubePlayerAdapter());
  const [view, setView] = useState<PlaybackView>(LOADING_VIEW);
  const [attempt, setAttempt] = useState(0);
  const titleRef = useRef(title);
  const startSecRef = useRef(initialStartSec);

  useEffect(() => {
    titleRef.current = title;
    startSecRef.current = initialStartSec;
  }, [title, initialStartSec]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    let isCancelled = false;
    let player: YouTubePlayerHandle | null = null;
    const fail = (errorKind: YouTubePlaybackErrorKind): void => {
      if (isCancelled) return;
      adapter.detachPlayer();
      setView(toErrorView(errorKind));
    };
    loadYouTubeIframeApi().then((api) => {
      if (isCancelled) return;
      const mount = document.createElement("div");
      host.appendChild(mount);
      player = new api.Player(mount, {
        host: YOUTUBE_NOCOOKIE_HOST,
        videoId,
        width: "100%",
        height: "100%",
        playerVars: buildPlayerVars(startSecRef.current),
        events: {
          onReady: (): void => {
            if (isCancelled || player === null) return;
            adapter.attachPlayer(player);
            host.querySelector("iframe")?.setAttribute("title", titleRef.current);
            setView(READY_VIEW);
          },
          onStateChange: (event): void => {
            if (!isCancelled) adapter.handleStateChange(event.data);
          },
          onError: (event): void => fail(classifyYouTubeErrorCode(event.data)),
        },
      });
    }).catch(() => fail("load-failed"));
    return () => {
      isCancelled = true;
      adapter.detachPlayer();
      try {
        player?.destroy();
      } catch {
        // The player may already be gone with its iframe.
      }
      host.replaceChildren();
    };
  }, [adapter, videoId, attempt]);

  const retry = useCallback((): void => {
    setView(LOADING_VIEW);
    setAttempt((current) => current + 1);
  }, []);

  const focusPlayer = useCallback((): void => {
    hostRef.current?.querySelector("iframe")?.focus();
  }, []);

  const { errorKind } = view;
  return {
    hostRef,
    adapter,
    phase: view.phase,
    errorKind,
    errorMessage: errorKind === null ? null : getYouTubePlaybackErrorMessage(errorKind),
    isSourceUnavailable: errorKind === "unavailable",
    canRetry: errorKind !== null && canRetryYouTubePlayback(errorKind),
    retry,
    focusPlayer,
  };
}
