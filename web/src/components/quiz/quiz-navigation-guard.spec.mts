import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The native Node test runner loads this source TypeScript file directly.
// @ts-expect-error TS5097: this test intentionally imports a .ts module.
import { confirmQuizNavigation } from "./quiz-navigation-guard.ts";

describe("confirmQuizNavigation", () => {
  it("cleans navigation guards without rewriting a cleared draft for submit navigation", () => {
    const events: string[] = [];

    confirmQuizNavigation({
      markConfirmed: () => events.push("confirmed"),
      cleanup: () => events.push("cleaned"),
      onBeforeConfirmedLeave: () => events.push("before-leave"),
      persistDraft: () => events.push("persisted"),
    }, { persistDraft: false });

    assert.deepEqual(events, ["confirmed", "cleaned", "before-leave"]);
  });

  it("persists the latest draft for a normal confirmed leave", () => {
    const events: string[] = [];

    confirmQuizNavigation({
      markConfirmed: () => events.push("confirmed"),
      cleanup: () => events.push("cleaned"),
      persistDraft: () => events.push("persisted"),
    });

    assert.deepEqual(events, ["confirmed", "cleaned", "persisted"]);
  });
});
