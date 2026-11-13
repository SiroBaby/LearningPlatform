import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canRetryYouTubePlayback,
  classifyYouTubeErrorCode,
  getYouTubePlaybackErrorMessage,
} from "./youtube-playback-errors.ts";

test("codes 2, 100, 101, 150 and 153 are fatal: the source is unavailable and cannot be retried", () => {
  for (const code of [2, 100, 101, 150, 153]) {
    const kind = classifyYouTubeErrorCode(code);
    assert.equal(kind, "unavailable", String(code));
    assert.equal(canRetryYouTubePlayback(kind), false, String(code));
  }
});

test("code 5 and unknown codes can be retried", () => {
  for (const code of [5, 0, 999]) {
    const kind = classifyYouTubeErrorCode(code);
    assert.equal(kind, "unplayable", String(code));
    assert.equal(canRetryYouTubePlayback(kind), true, String(code));
  }
  assert.equal(canRetryYouTubePlayback("load-failed"), true);
});

test("each error has short Vietnamese copy", () => {
  assert.equal(getYouTubePlaybackErrorMessage("unavailable"), "Video này không còn phát được. Bạn vẫn có thể làm quiz.");
  assert.equal(getYouTubePlaybackErrorMessage("unplayable"), "Trình duyệt không phát được video này.");
  assert.equal(getYouTubePlaybackErrorMessage("load-failed"), "Không tải được trình phát video.");
});
