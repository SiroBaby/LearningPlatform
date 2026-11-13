import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findAnsweredGroupIds,
  getCheckpointProgressKey,
  parseCheckpointProgress,
  serializeCheckpointProgress,
} from "./checkpoint-progress.ts";

test("uses a per-quiz storage key", () => {
  assert.equal(getCheckpointProgressKey("q-1"), "learning-platform:media-checkpoints:q-1");
});

test("round-trips answered questions", () => {
  const raw = serializeCheckpointProgress({ a: true, b: false, c: null });

  assert.deepEqual(parseCheckpointProgress(raw), { a: true, b: false, c: null });
});

test("ignores missing, malformed or wrong-version data", () => {
  for (const raw of [null, "", "not json", "[]", "null", '{"v":2,"answered":{}}', '{"v":1}', '{"v":1,"answered":null}']) {
    assert.deepEqual(parseCheckpointProgress(raw), {}, String(raw));
  }
});

test("drops entries that are not true, false or null", () => {
  const raw = '{"v":1,"answered":{"a":true,"b":"yes","c":1}}';

  assert.deepEqual(parseCheckpointProgress(raw), { a: true });
});

test("a group counts as answered only when every question was answered", () => {
  const groups = [
    { id: "a", questionIds: ["a", "b"] },
    { id: "c", questionIds: ["c"] },
  ];

  assert.deepEqual(findAnsweredGroupIds(groups, { a: true, c: false }), ["c"]);
  assert.deepEqual(findAnsweredGroupIds(groups, { a: true, b: null, c: false }), ["a", "c"]);
});
