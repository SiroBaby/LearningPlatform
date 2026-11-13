import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SUBTITLE_SIZE_BYTES, normalizeSubtitleSelection } from "./subtitle-file.ts";

const file = (name, size = 1000, type = "") => ({ name, size, type });

test("accepts .vtt and .srt whatever the browser reports as the type", () => {
  for (const candidate of [file("bai-giang.vtt", 10, "text/vtt"), file("bai-giang.SRT"), file("a.srt", 10, "application/x-subrip"), file("a.vtt", 10, "text/plain")]) {
    const result = normalizeSubtitleSelection(candidate);
    assert.equal("error" in result, false, candidate.name);
    assert.equal(result.normalizedType, "YOUTUBE");
    assert.equal(result.file, candidate);
  }
});

test("rejects other extensions and types with the format message", () => {
  for (const candidate of [file("a.txt"), file("a"), file("a.vtt", 10, "application/pdf"), file("a.mp4", 10, "video/mp4")]) {
    assert.deepEqual(normalizeSubtitleSelection(candidate), { error: "File phụ đề không đúng dạng .vtt hoặc .srt." }, candidate.name);
  }
});

test("rejects an empty file and a file over 5 MB", () => {
  assert.deepEqual(normalizeSubtitleSelection(file("a.vtt", 0)), { error: "File trống. Chọn file khác." });
  assert.equal(MAX_SUBTITLE_SIZE_BYTES, 5 * 1024 * 1024);
  assert.equal("error" in normalizeSubtitleSelection(file("a.vtt", MAX_SUBTITLE_SIZE_BYTES)), false);
  assert.deepEqual(normalizeSubtitleSelection(file("a.vtt", MAX_SUBTITLE_SIZE_BYTES + 1)), { error: "File phụ đề tối đa 5 MB." });
});
