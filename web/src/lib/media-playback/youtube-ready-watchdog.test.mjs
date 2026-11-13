import assert from "node:assert/strict";
import { test } from "node:test";

import { YOUTUBE_READY_TIMEOUT_MS, createReadyWatchdog } from "./youtube-ready-watchdog.ts";

function createTimers() {
  const entries = new Map();
  let nextId = 1;
  return {
    setTimeout: (callback, delayMs) => { const id = nextId++; entries.set(id, { callback, delayMs }); return id; },
    clearTimeout: (id) => { entries.delete(id); },
    entries,
    fireAll() { for (const [id, entry] of [...entries]) { entries.delete(id); entry.callback(); } },
  };
}

test("fires once after 15 seconds when not cancelled", () => {
  const timers = createTimers();
  let fired = 0;
  const watchdog = createReadyWatchdog(() => { fired += 1; }, timers);

  watchdog.start();
  assert.equal([...timers.entries.values()][0].delayMs, YOUTUBE_READY_TIMEOUT_MS);
  assert.equal(YOUTUBE_READY_TIMEOUT_MS, 15_000);
  timers.fireAll();

  assert.equal(fired, 1);
  assert.equal(timers.entries.size, 0);
});

test("cancel prevents the timeout, and is safe to repeat", () => {
  const timers = createTimers();
  let fired = 0;
  const watchdog = createReadyWatchdog(() => { fired += 1; }, timers);

  watchdog.start();
  watchdog.cancel();
  watchdog.cancel();
  timers.fireAll();

  assert.equal(fired, 0);
});

test("starting again replaces the previous countdown", () => {
  const timers = createTimers();
  const watchdog = createReadyWatchdog(() => undefined, timers);

  watchdog.start();
  watchdog.start();

  assert.equal(timers.entries.size, 1);
});
