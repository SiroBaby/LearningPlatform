/**
 * Pure refresh policy for presigned media URLs. No React, no I/O: the hook owns timers
 * and network calls, this module owns every decision so it can be tested with `node --test`.
 * All deadlines are computed from the local receipt time plus ttlSec, so clock skew between
 * server and browser never matters.
 */

export const REFRESH_MARGIN_MS = 15 * 60 * 1000;
export const PLAY_GUARD_MS = 60 * 1000;
export const RETRY_BACKOFF_MS = [1000, 3000, 7000] as const;
export const MAX_RETRY_AFTER_MS = 60 * 1000;
export const MANUAL_RETRY_COOLDOWN_MS = 5000;
export const MAX_AUTOMATIC_RETRIES = RETRY_BACKOFF_MS.length;

const MILLISECONDS_PER_SECOND = 1000;
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;
const TOO_MANY_REQUESTS_STATUS = 429;
const FIRST_CLIENT_ERROR_STATUS = 400;
const FIRST_SERVER_ERROR_STATUS = 500;
const REQUEST_TIMEOUT_STATUS = 408;

export type PlaybackPhase = "idle" | "loading" | "ready" | "refreshing" | "retry-wait" | "error";

export type PlaybackFailureKind =
  | "network"
  | "rate-limited"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "not-ready";

export interface PlaybackFailureInput {
  /** HTTP status, or 0 when the request never produced a response. */
  readonly status: number;
  readonly retryAfterSec?: number;
}

export interface PlaybackState {
  readonly phase: PlaybackPhase;
  readonly hasSource: boolean;
  /** Local epoch ms after which the current URL stops working. */
  readonly deadlineMs: number | null;
  /** Failed automatic attempts in the current retry budget. */
  readonly attempt: number;
  readonly failureKind: PlaybackFailureKind | null;
  readonly retryAtMs: number | null;
  /** No automatic refresh is scheduled before this time (after an exhausted budget with a usable URL). */
  readonly cooldownUntilMs: number | null;
  readonly manualRetryAvailableAtMs: number | null;
}

export type PlaybackEvent =
  | { readonly type: "REQUEST_STARTED" }
  | { readonly type: "REQUEST_SUCCEEDED"; readonly receivedAtMs: number; readonly ttlSec: number }
  | { readonly type: "REQUEST_FAILED"; readonly nowMs: number; readonly failure: PlaybackFailureInput }
  | { readonly type: "SOURCE_FAILED"; readonly nowMs: number }
  | { readonly type: "MANUAL_RETRY"; readonly nowMs: number };

export const initialPlaybackState: PlaybackState = {
  phase: "idle",
  hasSource: false,
  deadlineMs: null,
  attempt: 0,
  failureKind: null,
  retryAtMs: null,
  cooldownUntilMs: null,
  manualRetryAvailableAtMs: null,
};

const FAILURE_MESSAGES: Readonly<Record<PlaybackFailureKind, string>> = {
  network: "Chưa phát được nội dung. Kiểm tra kết nối rồi thử lại.",
  "rate-limited": "Bạn thao tác hơi nhanh. Thử lại sau ít giây.",
  unauthorized: "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.",
  forbidden: "Bạn không còn quyền xem nội dung này.",
  "not-found": "Không tìm thấy tài liệu này.",
  "not-ready": "Nội dung chưa sẵn sàng để phát.",
};

const FATAL_FAILURE_KINDS: readonly PlaybackFailureKind[] = ["unauthorized", "forbidden", "not-found", "not-ready"];

export function classifyPlaybackFailure(status: number): PlaybackFailureKind {
  if (status === UNAUTHORIZED_STATUS) return "unauthorized";
  if (status === FORBIDDEN_STATUS) return "forbidden";
  if (status === NOT_FOUND_STATUS) return "not-found";
  if (status === CONFLICT_STATUS) return "not-ready";
  if (status === TOO_MANY_REQUESTS_STATUS) return "rate-limited";
  const isOtherClientError = status >= FIRST_CLIENT_ERROR_STATUS
    && status < FIRST_SERVER_ERROR_STATUS
    && status !== REQUEST_TIMEOUT_STATUS;
  return isOtherClientError ? "forbidden" : "network";
}

export function isFatalPlaybackFailure(kind: PlaybackFailureKind): boolean {
  return FATAL_FAILURE_KINDS.includes(kind);
}

export function getPlaybackFailureMessage(kind: PlaybackFailureKind): string {
  return FAILURE_MESSAGES[kind];
}

/** Backoff for the nth automatic retry (0-based); a 429 `Retry-After` can only lengthen it, capped at 60s. */
export function computeRetryDelayMs(retryIndex: number, retryAfterSec?: number): number {
  const lastIndex = RETRY_BACKOFF_MS.length - 1;
  const backoffMs = RETRY_BACKOFF_MS[Math.min(Math.max(retryIndex, 0), lastIndex)];
  const hasRetryAfter = typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec > 0;
  const retryAfterMs = hasRetryAfter ? Math.min(retryAfterSec * MILLISECONDS_PER_SECOND, MAX_RETRY_AFTER_MS) : 0;
  return Math.max(backoffMs, retryAfterMs);
}

export function computeDeadlineMs(receivedAtMs: number, ttlSec: number): number {
  return receivedAtMs + ttlSec * MILLISECONDS_PER_SECOND;
}

/** True when the URL is inside the refresh margin (or already expired). */
export function isRefreshDue(deadlineMs: number | null, nowMs: number): boolean {
  return deadlineMs !== null && deadlineMs - nowMs <= REFRESH_MARGIN_MS;
}

/** True when starting playback now could outlive the URL; refresh before playing. */
export function isTooCloseToExpiryForPlay(deadlineMs: number | null, nowMs: number): boolean {
  return deadlineMs !== null && deadlineMs - nowMs <= PLAY_GUARD_MS;
}

/** Wake-ups (tab visible, back online) refresh only a healthy source; retry-wait and error own their timers. */
export function shouldRefreshOnWake(state: PlaybackState, nowMs: number): boolean {
  return state.phase === "ready" && state.hasSource && isRefreshDue(state.deadlineMs, nowMs);
}

/** Play (button or native controls) must refresh first when the URL is about to expire. */
export function shouldRefreshBeforePlay(state: PlaybackState, nowMs: number): boolean {
  return state.hasSource && state.phase !== "loading" && isTooCloseToExpiryForPlay(state.deadlineMs, nowMs);
}

/** Back online: retry a non-fatal error once its cooldown has elapsed. */
export function shouldRetryOnOnline(state: PlaybackState, nowMs: number): boolean {
  return state.phase === "error"
    && state.failureKind !== null
    && !isFatalPlaybackFailure(state.failureKind)
    && computeRetryAvailableInSec(state, nowMs) === 0;
}

export const MAX_MEDIA_RECOVERIES_PER_SOURCE = 1;

export type MediaErrorAction = "ignore" | "recover" | "fail";

/** One automatic URL refresh per failing source, then a visible error; ignored before any source exists. */
export function decideMediaErrorAction(state: PlaybackState, recoveries: number): MediaErrorAction {
  if (!state.hasSource || state.phase === "loading") return "ignore";
  return recoveries < MAX_MEDIA_RECOVERIES_PER_SOURCE ? "recover" : "fail";
}

/** Milliseconds until the next scheduled refresh: T-15min, but never before a cooldown ends. */
export function computeScheduledRefreshDelayMs(state: PlaybackState, nowMs: number): number | null {
  if (!state.hasSource || state.deadlineMs === null) return null;
  const refreshAtMs = Math.max(state.deadlineMs - REFRESH_MARGIN_MS, state.cooldownUntilMs ?? 0);
  return Math.max(0, refreshAtMs - nowMs);
}

/** Seconds a retry button must stay disabled (0 when available). */
export function computeRetryAvailableInSec(state: PlaybackState, nowMs: number): number {
  if (state.manualRetryAvailableAtMs === null) return 0;
  return Math.max(0, Math.ceil((state.manualRetryAvailableAtMs - nowMs) / MILLISECONDS_PER_SECOND));
}

/** A failed refresh can stay silent only while the current URL will still play. */
function isCurrentSourceUsable(state: PlaybackState, nowMs: number): boolean {
  return state.hasSource && !isTooCloseToExpiryForPlay(state.deadlineMs, nowMs);
}

function reduceFailure(state: PlaybackState, nowMs: number, failure: PlaybackFailureInput): PlaybackState {
  const failureKind = classifyPlaybackFailure(failure.status);
  if (isFatalPlaybackFailure(failureKind)) {
    return { ...state, phase: "error", failureKind, retryAtMs: null, manualRetryAvailableAtMs: null };
  }
  if (state.attempt < MAX_AUTOMATIC_RETRIES) {
    const retryDelayMs = computeRetryDelayMs(state.attempt, failure.retryAfterSec);
    return {
      ...state,
      phase: "retry-wait",
      attempt: state.attempt + 1,
      failureKind,
      retryAtMs: nowMs + retryDelayMs,
    };
  }
  if (isCurrentSourceUsable(state, nowMs)) {
    return {
      ...state,
      phase: "ready",
      attempt: 0,
      failureKind: null,
      retryAtMs: null,
      cooldownUntilMs: nowMs + MAX_RETRY_AFTER_MS,
    };
  }
  const cooldownMs = failureKind === "rate-limited"
    ? computeRetryDelayMs(MAX_AUTOMATIC_RETRIES, failure.retryAfterSec)
    : MANUAL_RETRY_COOLDOWN_MS;
  return {
    ...state,
    phase: "error",
    failureKind,
    retryAtMs: null,
    manualRetryAvailableAtMs: nowMs + Math.max(cooldownMs, MANUAL_RETRY_COOLDOWN_MS),
  };
}

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "REQUEST_STARTED":
      return { ...state, phase: state.hasSource ? "refreshing" : "loading", retryAtMs: null };
    case "REQUEST_SUCCEEDED":
      return {
        phase: "ready",
        hasSource: true,
        deadlineMs: computeDeadlineMs(event.receivedAtMs, event.ttlSec),
        attempt: 0,
        failureKind: null,
        retryAtMs: null,
        cooldownUntilMs: null,
        manualRetryAvailableAtMs: null,
      };
    case "REQUEST_FAILED":
      return reduceFailure(state, event.nowMs, event.failure);
    case "SOURCE_FAILED":
      return {
        ...state,
        phase: "error",
        failureKind: "network",
        retryAtMs: null,
        manualRetryAvailableAtMs: event.nowMs + MANUAL_RETRY_COOLDOWN_MS,
      };
    case "MANUAL_RETRY": {
      const isCoolingDown = state.manualRetryAvailableAtMs !== null && event.nowMs < state.manualRetryAvailableAtMs;
      if (state.phase !== "error" || isCoolingDown || state.failureKind === null || isFatalPlaybackFailure(state.failureKind)) {
        return state;
      }
      return {
        ...state,
        phase: state.hasSource ? "refreshing" : "loading",
        attempt: 0,
        failureKind: null,
        retryAtMs: null,
        manualRetryAvailableAtMs: null,
      };
    }
  }
}
