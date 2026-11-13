import assert from "node:assert/strict";
import { test } from "node:test";

import { applySource } from "./apply-source.ts";

function createFakeElement(overrides = {}) {
  const listeners = new Map();
  const element = {
    src: "https://old.example/media",
    currentTime: 0,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    paused: true,
    playCalls: 0,
    playResult: () => Promise.resolve(),
    play() {
      element.playCalls += 1;
      return element.playResult();
    },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length;
    },
    ...overrides,
  };
  return element;
}

test("restores the position after the new source loads metadata", () => {
  const element = createFakeElement({ currentTime: 125.5 });

  applySource(element, { url: "https://new.example/media" });
  element.currentTime = 0;
  element.emit("loadedmetadata");

  assert.equal(element.src, "https://new.example/media");
  assert.equal(element.currentTime, 125.5);
});

test("keeps 1.25x and 1.5x playback rates", () => {
  for (const rate of [1.25, 1.5]) {
    const element = createFakeElement({ playbackRate: rate, currentTime: 10 });

    applySource(element, { url: "https://new.example/media" });
    assert.equal(element.defaultPlaybackRate, rate);
    element.playbackRate = 1;
    element.emit("loadedmetadata");

    assert.equal(element.playbackRate, rate);
  }
});

test("a paused element stays paused", () => {
  const element = createFakeElement({ paused: true, currentTime: 30 });

  applySource(element, { url: "https://new.example/media" });
  element.emit("loadedmetadata");

  assert.equal(element.playCalls, 0);
});

test("a playing element resumes once, even when both events fire", () => {
  const element = createFakeElement({ paused: false, currentTime: 30 });

  applySource(element, { url: "https://new.example/media" });
  element.emit("loadedmetadata");
  element.emit("canplay");

  assert.equal(element.playCalls, 1);
  assert.equal(element.listenerCount("canplay"), 0);
});

test("falls back to canplay when loadedmetadata never fires", () => {
  const element = createFakeElement({ currentTime: 42 });

  applySource(element, { url: "https://new.example/media" });
  element.currentTime = 0;
  element.emit("canplay");

  assert.equal(element.currentTime, 42);
});

test("swallows an autoplay rejection", async () => {
  const element = createFakeElement({ paused: false, currentTime: 5 });
  element.playResult = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));

  applySource(element, { url: "https://new.example/media" });
  element.emit("loadedmetadata");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(element.playCalls, 1);
});

test("a first source starts at startSec and honours resumePlayback overrides", () => {
  const element = createFakeElement({ src: "", currentTime: 0, defaultPlaybackRate: 1.5 });

  applySource(element, { url: "https://new.example/media", startSec: 90 });
  element.emit("loadedmetadata");

  assert.equal(element.currentTime, 90);
  assert.equal(element.playbackRate, 1.5);
  assert.equal(element.playCalls, 0);

  const pausedForExpiry = createFakeElement({ paused: true, currentTime: 12 });
  applySource(pausedForExpiry, { url: "https://new.example/media", resumePlayback: true });
  pausedForExpiry.emit("loadedmetadata");
  assert.equal(pausedForExpiry.playCalls, 1);
});

test("cancel stops a pending restore", () => {
  const element = createFakeElement({ paused: false, currentTime: 12 });

  applySource(element, { url: "https://new.example/media" }).cancel();
  element.emit("loadedmetadata");

  assert.equal(element.playCalls, 0);
  assert.equal(element.listenerCount("loadedmetadata"), 0);
});
