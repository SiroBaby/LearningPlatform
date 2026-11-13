import assert from "node:assert/strict";
import { test } from "node:test";

import {
  YOUTUBE_PLAY_TIMEOUT_MS,
  YOUTUBE_TIME_POLL_MS,
  createYouTubePlayerAdapter,
} from "./youtube-player-adapter.ts";

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const entries = new Map();
  return {
    setInterval: (callback, delayMs) => { const id = nextId++; entries.set(id, { callback, delayMs, due: now + delayMs, repeat: true }); return id; },
    clearInterval: (id) => { entries.delete(id); },
    setTimeout: (callback, delayMs) => { const id = nextId++; entries.set(id, { callback, delayMs, due: now + delayMs, repeat: false }); return id; },
    clearTimeout: (id) => { entries.delete(id); },
    activeCount: () => entries.size,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...entries.entries()].filter(([, entry]) => entry.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, entry] = next;
        now = entry.due;
        if (entry.repeat) entry.due += entry.delayMs; else entries.delete(id);
        entry.callback();
      }
      now = target;
    },
  };
}

function createFakePlayer() {
  const player = {
    time: 0,
    duration: 0,
    rate: 1,
    calls: [],
    getCurrentTime: () => player.time,
    getDuration: () => player.duration,
    getPlaybackRate: () => player.rate,
    playVideo: () => { player.calls.push("play"); },
    pauseVideo: () => { player.calls.push("pause"); },
    seekTo: (seconds, allowSeekAhead) => { player.calls.push(["seek", seconds, allowSeekAhead]); },
  };
  return player;
}

function setup() {
  const timers = createFakeTimers();
  const player = createFakePlayer();
  const adapter = createYouTubePlayerAdapter(timers);
  adapter.attachPlayer(player);
  const events = [];
  adapter.subscribe((event) => events.push(event));
  return { timers, player, adapter, events };
}

test("declares a polling player: no seek events and never a pending swap", () => {
  const { adapter } = setup();

  assert.equal(adapter.emitsSeekEvents, false);
  assert.equal(adapter.isSwapPending(), false);
});

test("playing emits play and a time tick, then polls every 250 ms", () => {
  const { adapter, player, timers, events } = setup();
  player.time = 5;

  adapter.handleStateChange(1);
  assert.deepEqual(events, [{ type: "play" }, { type: "time", timeSec: 5 }]);
  assert.equal(adapter.isPaused(), false);

  player.time = 5.25;
  timers.advance(YOUTUBE_TIME_POLL_MS);
  player.time = 5.5;
  timers.advance(YOUTUBE_TIME_POLL_MS);
  assert.deepEqual(events.slice(2), [{ type: "time", timeSec: 5.25 }, { type: "time", timeSec: 5.5 }]);
});

test("polling runs only while playing", () => {
  const { adapter, player, timers, events } = setup();
  player.time = 1;
  adapter.handleStateChange(1);
  adapter.handleStateChange(2);

  assert.equal(timers.activeCount(), 0);
  const count = events.length;
  timers.advance(YOUTUBE_TIME_POLL_MS * 4);
  assert.equal(events.length, count);
});

test("pausing emits pause and one final time tick", () => {
  const { adapter, player, events } = setup();
  adapter.handleStateChange(1);
  events.length = 0;
  player.time = 9;

  adapter.handleStateChange(2);

  assert.deepEqual(events, [{ type: "pause" }, { type: "time", timeSec: 9 }]);
  assert.equal(adapter.isPaused(), true);
});

test("ended stops polling and reports the position", () => {
  const { adapter, player, timers, events } = setup();
  adapter.handleStateChange(1);
  events.length = 0;
  player.time = 120;

  adapter.handleStateChange(0);

  assert.deepEqual(events, [{ type: "ended", timeSec: 120 }]);
  assert.equal(timers.activeCount(), 0);
  assert.equal(adapter.isPaused(), true);
});

test("buffering, cued and unstarted states are ignored", () => {
  const { adapter, events, timers } = setup();

  for (const state of [3, 5, -1]) adapter.handleStateChange(state);

  assert.deepEqual(events, []);
  assert.equal(timers.activeCount(), 0);
  assert.equal(adapter.isPaused(), true);
});

test("buffering while playing keeps the player playing", () => {
  const { adapter } = setup();
  adapter.handleStateChange(1);

  adapter.handleStateChange(3);

  assert.equal(adapter.isPaused(), false);
});

test("seekTo seeks with seek-ahead and reports the new position at once", () => {
  const { adapter, player, events } = setup();

  adapter.seekTo(42);

  assert.deepEqual(player.calls, [["seek", 42, true]]);
  assert.deepEqual(events, [{ type: "time", timeSec: 42 }]);
});

test("seekTo ignores a negative or non-finite time", () => {
  const { adapter, player, events } = setup();

  adapter.seekTo(-1);
  adapter.seekTo(Number.NaN);

  assert.deepEqual(player.calls, []);
  assert.deepEqual(events, []);
});

test("getDuration is null until the player reports a positive length", () => {
  const { adapter, player } = setup();

  assert.equal(adapter.getDuration(), null);
  player.duration = Number.NaN;
  assert.equal(adapter.getDuration(), null);
  player.duration = 300;
  assert.equal(adapter.getDuration(), 300);
});

test("reads the playback rate and falls back to 1", () => {
  const { adapter, player } = setup();

  assert.equal(adapter.getPlaybackRate(), 1);
  player.rate = 1.5;
  assert.equal(adapter.getPlaybackRate(), 1.5);
  player.rate = 0;
  assert.equal(adapter.getPlaybackRate(), 1);
});

test("play resolves on the next playing state, after the play event", async () => {
  const { adapter, player, events } = setup();
  const order = [];
  adapter.subscribe((event) => { if (event.type === "play") order.push("event"); });

  const promise = adapter.play().then(() => order.push("resolved"));
  assert.deepEqual(player.calls, ["play"]);
  adapter.handleStateChange(1);
  await promise;

  assert.deepEqual(order, ["event", "resolved"]);
  assert.equal(events[0].type, "play");
});

test("play rejects when the player does not start within 1.5 s", async () => {
  const { adapter, timers } = setup();

  const promise = adapter.play();
  timers.advance(YOUTUBE_PLAY_TIMEOUT_MS);

  await assert.rejects(promise, /did not start/u);
});

test("play resolves at once when already playing, without another play call", async () => {
  const { adapter, player } = setup();
  adapter.handleStateChange(1);

  await adapter.play();

  assert.deepEqual(player.calls, []);
});

test("a started play does not leave a timeout behind", async () => {
  const { adapter, timers } = setup();
  const promise = adapter.play();
  adapter.handleStateChange(1);
  await promise;
  adapter.handleStateChange(2);

  assert.equal(timers.activeCount(), 0);
});

test("pause stops the player and reports paused immediately", () => {
  const { adapter, player } = setup();
  adapter.handleStateChange(1);

  adapter.pause();

  assert.deepEqual(player.calls, ["pause"]);
  assert.equal(adapter.isPaused(), true);
});

test("without a player every read is safe and play rejects", async () => {
  const adapter = createYouTubePlayerAdapter(createFakeTimers());

  assert.equal(adapter.getCurrentTime(), 0);
  assert.equal(adapter.getDuration(), null);
  assert.equal(adapter.getPlaybackRate(), 1);
  assert.equal(adapter.isPaused(), true);
  adapter.pause();
  adapter.seekTo(3);
  await assert.rejects(adapter.play(), /not ready/u);
});

test("detaching stops polling, rejects a waiting play and the adapter can be attached again", async () => {
  const { adapter, timers, events } = setup();
  adapter.handleStateChange(1);
  const waiting = adapter.play();
  adapter.handleStateChange(2);
  const stillWaiting = adapter.play();

  adapter.detachPlayer();

  await assert.rejects(stillWaiting, /removed/u);
  await waiting;
  assert.equal(timers.activeCount(), 0);
  assert.equal(adapter.isPaused(), true);

  const nextPlayer = createFakePlayer();
  nextPlayer.time = 7;
  adapter.attachPlayer(nextPlayer);
  events.length = 0;
  adapter.handleStateChange(1);
  assert.deepEqual(events, [{ type: "play" }, { type: "time", timeSec: 7 }]);
});

test("unsubscribe stops delivery, and a listener may unsubscribe while handling an event", () => {
  const { adapter, player } = setup();
  const received = [];
  const unsubscribe = adapter.subscribe((event) => { received.push(event.type); unsubscribe(); });
  player.time = 1;

  adapter.handleStateChange(1);
  adapter.handleStateChange(2);

  assert.deepEqual(received, ["play"]);
});
