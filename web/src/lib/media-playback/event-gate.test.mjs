import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldForwardPlayerEvent } from "./event-gate.ts";

test("position events are held back while a source swap is pending", () => {
  assert.equal(shouldForwardPlayerEvent("time", true), false);
  assert.equal(shouldForwardPlayerEvent("seeked", true), false);
});

test("state events always pass, and position events pass once the swap restored", () => {
  for (const type of ["play", "pause", "ended"]) {
    assert.equal(shouldForwardPlayerEvent(type, true), true);
  }
  assert.equal(shouldForwardPlayerEvent("time", false), true);
  assert.equal(shouldForwardPlayerEvent("seeked", false), true);
});
