import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MANUAL_RETRY_COOLDOWN_MS,
  PLAY_GUARD_MS,
  REFRESH_MARGIN_MS,
  classifyPlaybackFailure,
  computeRetryAvailableInSec,
  computeRetryDelayMs,
  computeScheduledRefreshDelayMs,
  getPlaybackFailureMessage,
  initialPlaybackState,
  isRefreshDue,
  isTooCloseToExpiryForPlay,
  playbackReducer,
} from "./playback-refresh-policy.ts";

const NOW_MS = 1_000_000;
const TTL_SEC = 14_400;

function reduce(state, ...events) {
  return events.reduce(playbackReducer, state);
}

function readyState() {
  return reduce(
    initialPlaybackState,
    { type: "REQUEST_STARTED" },
    { type: "REQUEST_SUCCEEDED", receivedAtMs: NOW_MS, ttlSec: TTL_SEC },
  );
}

test("computes the deadline from local receipt time plus ttlSec", () => {
  const actualState = readyState();

  assert.equal(actualState.phase, "ready");
  assert.equal(actualState.deadlineMs, NOW_MS + TTL_SEC * 1000);
});

test("schedules the refresh 15 minutes before the deadline", () => {
  const actualDelay = computeScheduledRefreshDelayMs(readyState(), NOW_MS);

  assert.equal(actualDelay, TTL_SEC * 1000 - REFRESH_MARGIN_MS);
  assert.equal(computeScheduledRefreshDelayMs(readyState(), NOW_MS + TTL_SEC * 1000), 0);
  assert.equal(computeScheduledRefreshDelayMs(initialPlaybackState, NOW_MS), null);
});

test("detects refresh due and the 60 second play guard", () => {
  const deadlineMs = NOW_MS + TTL_SEC * 1000;

  assert.equal(isRefreshDue(deadlineMs, deadlineMs - REFRESH_MARGIN_MS - 1), false);
  assert.equal(isRefreshDue(deadlineMs, deadlineMs - REFRESH_MARGIN_MS), true);
  assert.equal(isTooCloseToExpiryForPlay(deadlineMs, deadlineMs - PLAY_GUARD_MS - 1), false);
  assert.equal(isTooCloseToExpiryForPlay(deadlineMs, deadlineMs - PLAY_GUARD_MS), true);
  assert.equal(isTooCloseToExpiryForPlay(null, NOW_MS), false);
});

test("backs off 1s, 3s, 7s and honours a capped Retry-After", () => {
  assert.deepEqual([0, 1, 2].map((index) => computeRetryDelayMs(index)), [1000, 3000, 7000]);
  assert.equal(computeRetryDelayMs(0, 10), 10_000);
  assert.equal(computeRetryDelayMs(2, 2), 7000);
  assert.equal(computeRetryDelayMs(0, 600), 60_000);
  assert.equal(computeRetryDelayMs(0, Number.NaN), 1000);
});

test("classifies statuses: 401/403/404/409 fatal, 429 and transport errors retryable", () => {
  assert.equal(classifyPlaybackFailure(401), "unauthorized");
  assert.equal(classifyPlaybackFailure(403), "forbidden");
  assert.equal(classifyPlaybackFailure(404), "not-found");
  assert.equal(classifyPlaybackFailure(409), "not-ready");
  assert.equal(classifyPlaybackFailure(429), "rate-limited");
  for (const status of [0, 408, 500, 502, 503]) {
    assert.equal(classifyPlaybackFailure(status), "network", String(status));
  }
});

test("fatal failures go straight to error without retries or retry button", () => {
  for (const status of [401, 403, 404, 409]) {
    const actualState = reduce(readyState(), { type: "REQUEST_FAILED", nowMs: NOW_MS, failure: { status } });
    assert.equal(actualState.phase, "error", String(status));
    assert.equal(actualState.attempt, 0);
    assert.equal(playbackReducer(actualState, { type: "MANUAL_RETRY", nowMs: NOW_MS + 60_000 }), actualState);
  }
});

test("shares a three-retry budget between network errors and 429", () => {
  const failures = [
    { status: 503 },
    { status: 429, retryAfterSec: 20 },
    { status: 0 },
  ];
  let actualState = initialPlaybackState;
  const retryAts = [];
  for (const [index, failure] of failures.entries()) {
    actualState = reduce(actualState, { type: "REQUEST_STARTED" }, { type: "REQUEST_FAILED", nowMs: NOW_MS, failure });
    assert.equal(actualState.phase, "retry-wait", `attempt ${index}`);
    retryAts.push(actualState.retryAtMs - NOW_MS);
  }

  assert.deepEqual(retryAts, [1000, 20_000, 7000]);

  actualState = reduce(actualState, { type: "REQUEST_STARTED" }, { type: "REQUEST_FAILED", nowMs: NOW_MS, failure: { status: 503 } });
  assert.equal(actualState.phase, "error");
  assert.equal(actualState.manualRetryAvailableAtMs, NOW_MS + MANUAL_RETRY_COOLDOWN_MS);
});

test("keeps the old URL silently usable while it still has time, then backs off for a minute", () => {
  let actualState = readyState();
  const nowMs = NOW_MS + TTL_SEC * 1000 - REFRESH_MARGIN_MS;
  for (let index = 0; index < 4; index += 1) {
    actualState = reduce(actualState, { type: "REQUEST_STARTED" }, { type: "REQUEST_FAILED", nowMs, failure: { status: 503 } });
  }

  assert.equal(actualState.phase, "ready");
  assert.equal(actualState.failureKind, null);
  assert.equal(actualState.cooldownUntilMs, nowMs + 60_000);
  assert.equal(computeScheduledRefreshDelayMs(actualState, nowMs), 60_000);
});

test("shows the error when retries are exhausted and the old URL is about to expire", () => {
  let actualState = readyState();
  const nowMs = NOW_MS + TTL_SEC * 1000 - PLAY_GUARD_MS;
  for (let index = 0; index < 4; index += 1) {
    actualState = reduce(actualState, { type: "REQUEST_STARTED" }, { type: "REQUEST_FAILED", nowMs, failure: { status: 503 } });
  }

  assert.equal(actualState.phase, "error");
  assert.equal(actualState.hasSource, true);
});

test("manual retry respects the 5 second cooldown", () => {
  let errorState = initialPlaybackState;
  for (let index = 0; index < 4; index += 1) {
    errorState = reduce(errorState, { type: "REQUEST_STARTED" }, { type: "REQUEST_FAILED", nowMs: NOW_MS, failure: { status: 503 } });
  }

  assert.equal(computeRetryAvailableInSec(errorState, NOW_MS + 1500), 4);
  assert.equal(playbackReducer(errorState, { type: "MANUAL_RETRY", nowMs: NOW_MS + 4999 }), errorState);
  const actualState = playbackReducer(errorState, { type: "MANUAL_RETRY", nowMs: NOW_MS + 5000 });
  assert.equal(actualState.phase, "loading");
  assert.equal(actualState.attempt, 0);
  assert.equal(computeRetryAvailableInSec(actualState, NOW_MS + 5000), 0);
});

test("a rate limited exhaustion waits for Retry-After before manual retry", () => {
  let actualState = initialPlaybackState;
  for (let index = 0; index < 4; index += 1) {
    actualState = reduce(actualState, { type: "REQUEST_STARTED" }, {
      type: "REQUEST_FAILED",
      nowMs: NOW_MS,
      failure: { status: 429, retryAfterSec: 30 },
    });
  }

  assert.equal(actualState.manualRetryAvailableAtMs, NOW_MS + 30_000);
});

test("a media element failure ends in a retryable error", () => {
  const actualState = reduce(readyState(), { type: "SOURCE_FAILED", nowMs: NOW_MS });

  assert.equal(actualState.phase, "error");
  assert.equal(actualState.failureKind, "network");
});

test("a refresh moves ready -> refreshing -> ready with a new deadline", () => {
  const refreshing = playbackReducer(readyState(), { type: "REQUEST_STARTED" });
  const actualState = playbackReducer(refreshing, { type: "REQUEST_SUCCEEDED", receivedAtMs: NOW_MS + 5, ttlSec: 100 });

  assert.equal(refreshing.phase, "refreshing");
  assert.equal(actualState.phase, "ready");
  assert.equal(actualState.deadlineMs, NOW_MS + 5 + 100_000);
});

test("exposes the exact Vietnamese failure copy", () => {
  assert.equal(getPlaybackFailureMessage("network"), "Chưa phát được nội dung. Kiểm tra kết nối rồi thử lại.");
  assert.equal(getPlaybackFailureMessage("rate-limited"), "Bạn thao tác hơi nhanh. Thử lại sau ít giây.");
  assert.equal(getPlaybackFailureMessage("unauthorized"), "Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục.");
  assert.equal(getPlaybackFailureMessage("forbidden"), "Bạn không còn quyền xem nội dung này.");
  assert.equal(getPlaybackFailureMessage("not-found"), "Không tìm thấy tài liệu này.");
  assert.equal(getPlaybackFailureMessage("not-ready"), "Nội dung chưa sẵn sàng để phát.");
});
