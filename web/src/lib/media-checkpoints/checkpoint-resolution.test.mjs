import assert from "node:assert/strict";
import { test } from "node:test";

import { decideNativePlayOutcome, findNextUnansweredQuestionId } from "./checkpoint-resolution.ts";

const group = { questionIds: ["a", "b", "c"] };

test("finds the first unanswered question, optionally after a given one", () => {
  assert.equal(findNextUnansweredQuestionId(group, { a: true }), "b");
  assert.equal(findNextUnansweredQuestionId(group, { a: true }, "a"), "b");
  assert.equal(findNextUnansweredQuestionId(group, { b: false }, "a"), "c");
  assert.equal(findNextUnansweredQuestionId(group, { a: true, b: true, c: true }), null);
  assert.equal(findNextUnansweredQuestionId(undefined, {}), null);
});

test("native play after answering every question counts as answered", () => {
  assert.equal(decideNativePlayOutcome(group, { a: true, b: false, c: true }), "answered");
});

test("native play with unanswered questions left counts as skipped", () => {
  assert.equal(decideNativePlayOutcome(group, { a: true }), "skipped");
  assert.equal(decideNativePlayOutcome(undefined, {}), "skipped");
});

test("an empty open group (nothing left to ask) resolves as answered", () => {
  assert.equal(decideNativePlayOutcome({ questionIds: [] }, {}), "answered");
});
