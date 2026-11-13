import assert from "node:assert/strict";
import { test } from "node:test";

import { YOUTUBE_IFRAME_API_TIMEOUT_MS, YOUTUBE_IFRAME_API_URL, createYouTubeApiLoader } from "./youtube-iframe-api.ts";

function createEnvironment(win = {}) {
  const timeouts = [];
  const scripts = [];
  const removed = [];
  return {
    win,
    timeouts,
    scripts,
    removed,
    environment: {
      getWindow: () => win,
      addScript: (src, onError) => {
        const script = { src, onError };
        scripts.push(script);
        return () => removed.push(src);
      },
      setTimeout: (callback, delayMs) => { const handle = { callback, delayMs, isCleared: false }; timeouts.push(handle); return handle; },
      clearTimeout: (handle) => { handle.isCleared = true; },
    },
  };
}

class FakePlayer {}

test("loads the script once and resolves when the API calls its ready callback", async () => {
  const { win, environment, scripts } = createEnvironment();
  const load = createYouTubeApiLoader(environment);

  const first = load();
  const second = load();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, YOUTUBE_IFRAME_API_URL);
  assert.equal(first, second);

  win.YT = { Player: FakePlayer };
  win.onYouTubeIframeAPIReady();

  assert.equal((await first).Player, FakePlayer);
});

test("resolves at once, without a script, when the API is already on the page", async () => {
  const { environment, scripts } = createEnvironment({ YT: { Player: FakePlayer } });

  const api = await createYouTubeApiLoader(environment)();

  assert.equal(api.Player, FakePlayer);
  assert.equal(scripts.length, 0);
});

test("keeps a ready callback that was already registered", async () => {
  const { win, environment } = createEnvironment();
  const calls = [];
  win.onYouTubeIframeAPIReady = () => calls.push("previous");
  const promise = createYouTubeApiLoader(environment)();

  win.YT = { Player: FakePlayer };
  win.onYouTubeIframeAPIReady();
  await promise;

  assert.deepEqual(calls, ["previous"]);
});

test("rejects on timeout, removes the script and allows a retry", async () => {
  const { win, environment, timeouts, scripts, removed } = createEnvironment();
  const load = createYouTubeApiLoader(environment);

  const failed = load();
  assert.equal(timeouts[0].delayMs, YOUTUBE_IFRAME_API_TIMEOUT_MS);
  timeouts[0].callback();
  await assert.rejects(failed, /failed to load/u);
  assert.deepEqual(removed, [YOUTUBE_IFRAME_API_URL]);

  const retried = load();
  assert.notEqual(retried, failed);
  assert.equal(scripts.length, 2);
  win.YT = { Player: FakePlayer };
  win.onYouTubeIframeAPIReady();
  assert.equal((await retried).Player, FakePlayer);
});

test("rejects when the script fails to load", async () => {
  const { environment, scripts } = createEnvironment();
  const promise = createYouTubeApiLoader(environment)();

  scripts[0].onError();

  await assert.rejects(promise, /failed to load/u);
});

test("clears the timeout once loaded", async () => {
  const { win, environment, timeouts } = createEnvironment();
  const promise = createYouTubeApiLoader(environment)();

  win.YT = { Player: FakePlayer };
  win.onYouTubeIframeAPIReady();
  await promise;

  assert.equal(timeouts[0].isCleared, true);
});

test("a late ready callback after a timeout does not resolve the old attempt twice", async () => {
  const { win, environment, timeouts } = createEnvironment();
  const load = createYouTubeApiLoader(environment);
  const failed = load();
  const staleReady = win.onYouTubeIframeAPIReady;
  timeouts[0].callback();
  await assert.rejects(failed);

  win.YT = { Player: FakePlayer };
  staleReady();

  await assert.rejects(failed);
});

test("rejects without a browser", async () => {
  const load = createYouTubeApiLoader({ ...createEnvironment().environment, getWindow: () => undefined });

  await assert.rejects(load(), /needs a browser/u);
});
