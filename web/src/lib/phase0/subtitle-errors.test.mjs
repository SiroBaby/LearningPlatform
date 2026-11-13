import assert from "node:assert/strict";
import { test } from "node:test";

import { getSubtitleErrorMessage } from "./subtitle-errors.ts";

test("maps every fixed subtitle and link code to Vietnamese copy", () => {
  const expected = {
    YOUTUBE_URL_INVALID: "Link này không phải video YouTube. Kiểm tra lại link.",
    SUBTITLE_ENCODING_INVALID: "Không đọc được chữ trong file phụ đề. Lưu file dạng UTF-8 rồi thử lại.",
    SUBTITLE_FORMAT_INVALID: "File phụ đề không đúng dạng .vtt hoặc .srt.",
    SUBTITLE_TOO_MANY_CUES: "Phụ đề quá dài (tối đa 10.000 đoạn / 500.000 ký tự).",
    SUBTITLE_TOO_MANY_CHARS: "Phụ đề quá dài (tối đa 10.000 đoạn / 500.000 ký tự).",
    SUBTITLE_EMPTY: "Phụ đề không có nội dung.",
    SUBTITLE_TOO_LARGE: "File phụ đề tối đa 5 MB.",
  };
  for (const [code, message] of Object.entries(expected)) {
    assert.equal(getSubtitleErrorMessage({ code }), message, code);
  }
});

test("timestamp and long-cue errors name the source line when it is known", () => {
  assert.equal(getSubtitleErrorMessage({ code: "SUBTITLE_TIMESTAMP_INVALID", line: 12 }), "Dòng 12: mốc thời gian không đúng.");
  assert.equal(
    getSubtitleErrorMessage({ code: "SUBTITLE_CUE_TOO_LONG", line: 7 }),
    "Đoạn ở dòng 7 quá dài (tối đa 2.000 ký tự).",
  );
  assert.match(getSubtitleErrorMessage({ code: "SUBTITLE_TIMESTAMP_INVALID" }) ?? "", /Mốc thời gian/u);
  assert.match(getSubtitleErrorMessage({ code: "SUBTITLE_CUE_TOO_LONG" }) ?? "", /2\.000 ký tự/u);
});

test("unknown or missing codes return null so the caller can use its fallback", () => {
  assert.equal(getSubtitleErrorMessage({}), null);
  assert.equal(getSubtitleErrorMessage({ code: "SOMETHING_ELSE" }), null);
});

test("no learner copy exposes technical terms", () => {
  const messages = ["YOUTUBE_URL_INVALID", "SUBTITLE_EMPTY", "YOUTUBE_LESSONS_DISABLED", "SUBTITLE_PREVIEW_REQUIRED"]
    .map((code) => getSubtitleErrorMessage({ code }) ?? "");
  for (const message of messages) assert.doesNotMatch(message, /API|HTTP|backend|SUBTITLE_|YOUTUBE_/u);
});
