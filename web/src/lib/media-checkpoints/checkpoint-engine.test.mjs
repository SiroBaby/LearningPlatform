import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCheckpointEngine,
  getCheckpointStatus,
  isNearCheckpoint,
  reduceCheckpointEngine,
} from "./checkpoint-engine.ts";

const group = (id, atSec) => ({ id, atSec, startSec: Math.max(0, atSec - 10), questionIds: [id] });

function setup(groups, overrides = {}) {
  return createCheckpointEngine({ groups, enabled: true, emitsSeekEvents: true, ...overrides });
}

function send(state, event) {
  return reduceCheckpointEngine(state, event);
}

/** Plays at `rate` with ticks every `stepMs`, collecting every effect. */
function play(initial, { fromSec, toSec, rate = 1, stepMs = 250, startWallMs = 0 }) {
  let state = initial;
  const effects = [];
  const stepSec = (stepMs / 1000) * rate;
  let wall = startWallMs;
  for (let t = fromSec; t <= toSec + 1e-9; t += stepSec) {
    const result = send(state, { type: "TICK", timeSec: t, nowMs: wall, playbackRate: rate });
    state = result.state;
    if (result.effect) {
      effects.push(result.effect);
      if (result.effect.type === "PAUSE") break;
    }
    wall += stepMs;
  }
  return { state, effects };
}

test("the first tick is only a baseline and never fires", () => {
  const state = setup([group("a", 5)]);
  const { state: next, effect } = send(state, { type: "TICK", timeSec: 20, nowMs: 0, playbackRate: 1 });

  assert.equal(effect, null);
  assert.equal(getCheckpointStatus(next, "a"), "passed");
});

test("a start position before the checkpoint keeps it upcoming", () => {
  const state = setup([group("a", 30)]);
  const { state: next } = send(state, { type: "TICK", timeSec: 10, nowMs: 0, playbackRate: 1 });

  assert.equal(getCheckpointStatus(next, "a"), "upcoming");
});

for (const rate of [1, 1.25, 1.5, 2]) {
  test(`fires exactly once when crossing at ${rate}x with 250ms ticks`, () => {
    const baseline = send(setup([group("a", 10.1)]), { type: "TICK", timeSec: 0, nowMs: 0, playbackRate: rate }).state;
    const { state, effects } = play(baseline, { fromSec: 0.25 * rate, toSec: 20, rate, startWallMs: 250 });

    assert.deepEqual(effects, [{ type: "PAUSE", groupId: "a" }]);
    assert.equal(state.openGroupId, "a");
    assert.equal(getCheckpointStatus(state, "a"), "open");
  });
}

test("does not fire again after the checkpoint is answered", () => {
  const baseline = send(setup([group("a", 10)]), { type: "TICK", timeSec: 0, nowMs: 0, playbackRate: 1 }).state;
  const paused = play(baseline, { fromSec: 0.25, toSec: 20 }).state;
  const resumed = send(send(paused, { type: "PAUSED_AT", timeSec: 10.2 }).state, {
    type: "RESOLVE",
    groupId: "a",
    outcome: "answered",
  });
  const { effects } = play(resumed.state, { fromSec: 10.2, toSec: 30, startWallMs: 99000 });

  assert.deepEqual(resumed.effect, { type: "RESUME", timeSec: 10.2 });
  assert.deepEqual(effects, []);
  assert.equal(getCheckpointStatus(resumed.state, "a"), "answered");
});

test("a forward seek over a checkpoint marks it passed without firing", () => {
  let state = send(setup([group("a", 20)]), { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "SEEKED", timeSec: 40 });
  state = result.state;

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(state, "a"), "passed");
  assert.equal(play(state, { fromSec: 40, toSec: 60 }).effects.length, 0);
});

test("a backward seek re-arms passed checkpoints after the target but never answered ones", () => {
  let state = setup([group("a", 10), group("b", 30), group("c", 50)]);
  state = send(state, { type: "TICK", timeSec: 60, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "RESTORE_ANSWERED", groupIds: ["c"] }).state;
  state = send(state, { type: "SEEKED", timeSec: 20 }).state;

  assert.equal(getCheckpointStatus(state, "a"), "passed");
  assert.equal(getCheckpointStatus(state, "b"), "upcoming");
  assert.equal(getCheckpointStatus(state, "c"), "answered");
});

test("a seek of under 0.3 seconds is noise and changes no status", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "TICK", timeSec: 9.9, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "SEEKED", timeSec: 9.8 });

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(result.state, "a"), "upcoming");
  assert.equal(result.state.lastTimeSec, 9.8);
});

test("source swap restore (time resets to 0 then returns) does not re-arm or fire", () => {
  let state = setup([group("a", 5), group("b", 50)]);
  state = send(state, { type: "TICK", timeSec: 20, nowMs: 0, playbackRate: 1 }).state;
  // Swap restore lands on the same position the viewer was at.
  state = send(state, { type: "SEEKED", timeSec: 20.05 }).state;
  const { effects } = play(state, { fromSec: 20.05, toSec: 30, startWallMs: 100 });

  assert.deepEqual(effects, []);
  assert.equal(getCheckpointStatus(state, "a"), "passed");
});

test("detects a forward jump without seek events when the adapter does not emit them", () => {
  let state = setup([group("a", 20)], { emitsSeekEvents: false });
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "TICK", timeSec: 40, nowMs: 250, playbackRate: 1 });

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(result.state, "a"), "passed");
});

test("detects a backward jump without seek events and re-arms", () => {
  let state = setup([group("a", 10)], { emitsSeekEvents: false });
  state = send(state, { type: "TICK", timeSec: 30, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 2, nowMs: 250, playbackRate: 1 }).state;

  assert.equal(getCheckpointStatus(state, "a"), "upcoming");
});

test("a throttled tab with 1s ticks at 2x is not mistaken for a seek", () => {
  let state = setup([group("a", 11)]);
  state = send(state, { type: "TICK", timeSec: 0, nowMs: 0, playbackRate: 2 }).state;
  let result = send(state, { type: "TICK", timeSec: 2, nowMs: 1000, playbackRate: 2 });
  result = send(result.state, { type: "TICK", timeSec: 4, nowMs: 2000, playbackRate: 2 });
  result = send(result.state, { type: "TICK", timeSec: 12, nowMs: 5000, playbackRate: 2 });

  assert.deepEqual(result.effect, { type: "PAUSE", groupId: "a" });
});

test("two checkpoints crossed in one tick open the second after the first resolves", () => {
  let state = setup([group("a", 10), group("b", 11)]);
  state = send(state, { type: "TICK", timeSec: 9, nowMs: 0, playbackRate: 1 }).state;
  const crossed = send(state, { type: "TICK", timeSec: 11.5, nowMs: 2500, playbackRate: 1 });
  assert.deepEqual(crossed.effect, { type: "PAUSE", groupId: "a" });

  const paused = send(crossed.state, { type: "PAUSED_AT", timeSec: 11.5 }).state;
  const next = send(paused, { type: "RESOLVE", groupId: "a", outcome: "answered" });
  assert.deepEqual(next.effect, { type: "OPEN_NEXT", groupId: "b" });
  assert.equal(next.state.openGroupId, "b");

  const last = send(next.state, { type: "RESOLVE", groupId: "b", outcome: "skipped" });
  assert.deepEqual(last.effect, { type: "RESUME", timeSec: 11.5 });
  assert.equal(getCheckpointStatus(last.state, "b"), "passed");
});

test("resume uses the position where playback actually paused", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 }).state;
  state = send(state, { type: "PAUSED_AT", timeSec: 10.18 }).state;
  const result = send(state, { type: "RESOLVE", groupId: "a", outcome: "answered" });

  assert.deepEqual(result.effect, { type: "RESUME", timeSec: 10.18 });
});

test("resume uses the learner's seek target when they scrubbed while the question was open", () => {
  let state = setup([group("a", 10), group("b", 25)]);
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 }).state;
  state = send(state, { type: "PAUSED_AT", timeSec: 10.1 }).state;
  state = send(state, { type: "SEEKED", timeSec: 40 }).state;
  const result = send(state, { type: "RESOLVE", groupId: "a", outcome: "skipped" });

  assert.deepEqual(result.effect, { type: "RESUME", timeSec: 40 });
  assert.equal(getCheckpointStatus(result.state, "b"), "passed");
});

test("ended counts as a tick at the duration and fires a clamped checkpoint", () => {
  let state = setup([group("a", 59.5)]);
  state = send(state, { type: "TICK", timeSec: 59, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "ENDED", timeSec: 60 });

  assert.deepEqual(result.effect, { type: "PAUSE", groupId: "a" });
});

test("a disabled engine marks crossed checkpoints passed without pausing", () => {
  let state = setup([group("a", 10)], { enabled: false });
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 });

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(result.state, "a"), "passed");
});

test("turning the toggle off while a question is open skips it and resumes", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 }).state;
  const result = send(state, { type: "SET_ENABLED", enabled: false });

  assert.deepEqual(result.effect, { type: "RESUME", timeSec: 10.1 });
  assert.equal(result.state.openGroupId, null);
});

test("restoring answered groups prevents them from firing", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "RESTORE_ANSWERED", groupIds: ["a", "unknown"] }).state;
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  const result = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 });

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(result.state, "a"), "answered");
  assert.equal("unknown" in result.state.statuses, false);
});

test("a groups change keeps statuses by id and re-baselines the next tick", () => {
  let state = setup([group("a", 10), group("b", 30)]);
  state = send(state, { type: "RESTORE_ANSWERED", groupIds: ["a"] }).state;
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "GROUPS_CHANGED", groups: [group("a", 9.5), group("b", 30), group("c", 2)] }).state;

  assert.equal(state.lastTimeSec, null);
  assert.equal(getCheckpointStatus(state, "a"), "answered");
  const baseline = send(state, { type: "TICK", timeSec: 5, nowMs: 100, playbackRate: 1 });
  assert.equal(baseline.effect, null);
  assert.equal(getCheckpointStatus(baseline.state, "c"), "passed");
  assert.equal(getCheckpointStatus(baseline.state, "b"), "upcoming");
});

test("resolving a group that is not open is ignored", () => {
  const state = setup([group("a", 10)]);
  const result = send(state, { type: "RESOLVE", groupId: "a", outcome: "answered" });

  assert.equal(result.state, state);
  assert.equal(result.effect, null);
});

test("a backward seek while open does not re-arm the open group", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 10.1, nowMs: 250, playbackRate: 1 }).state;
  state = send(state, { type: "SEEKED", timeSec: 3 }).state;
  const result = send(state, { type: "RESOLVE", groupId: "a", outcome: "answered" });

  assert.deepEqual(result.effect, { type: "RESUME", timeSec: 3 });
  assert.equal(getCheckpointStatus(result.state, "a"), "answered");
});

test("isNearCheckpoint is true only within one second before an upcoming stop", () => {
  const state = setup([group("a", 10)]);

  assert.equal(isNearCheckpoint(state, 8.9), false);
  assert.equal(isNearCheckpoint(state, 9.5), true);
  assert.equal(isNearCheckpoint(state, 10.1), false);
  assert.equal(isNearCheckpoint(setup([group("a", 10)], { enabled: false }), 9.5), false);
});

test("browser order while paused: tick at the target before seeked does not open the jumped-over stop", () => {
  let state = setup([group("a", 20), group("b", 25)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 5.25, nowMs: 250, playbackRate: 1, isPaused: true }).state;
  const tick = send(state, { type: "TICK", timeSec: 40, nowMs: 60250, playbackRate: 1, isPaused: true });
  const seeked = send(tick.state, { type: "SEEKED", timeSec: 40, nowMs: 60251 });

  assert.equal(tick.effect, null);
  assert.equal(seeked.effect, null);
  assert.equal(getCheckpointStatus(seeked.state, "a"), "passed");
  assert.equal(getCheckpointStatus(seeked.state, "b"), "passed");
});

test("the pause tick itself is playback finishing: a stop inside the last interval still fires at 2x", () => {
  let state = setup([group("a", 30)]);
  state = send(state, { type: "TICK", timeSec: 29.4, nowMs: 0, playbackRate: 2 }).state;
  state = send(state, { type: "TICK", timeSec: 29.9, nowMs: 250, playbackRate: 2 }).state;
  const pauseTick = send(state, { type: "TICK", timeSec: 30.3, nowMs: 450, playbackRate: 2, isPaused: true });

  assert.deepEqual(pauseTick.effect, { type: "PAUSE", groupId: "a" });
});

test("a scrub that is the very first paused tick is still a seek, even after a long gap", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  const tick = send(state, { type: "TICK", timeSec: 40, nowMs: 60250, playbackRate: 1, isPaused: true });

  assert.equal(tick.effect, null);
  assert.equal(getCheckpointStatus(tick.state, "a"), "passed");
});

test("only the first paused tick after playing is treated as an advance", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 5.2, nowMs: 200, playbackRate: 1, isPaused: true }).state;
  const scrub = send(state, { type: "TICK", timeSec: 20.4, nowMs: 5000, playbackRate: 1, isPaused: true });

  assert.equal(scrub.effect, null);
  assert.equal(getCheckpointStatus(scrub.state, "a"), "passed");
});

test("the stale-wall scrub from the review (paused tick without the paused flag) still needs the flag", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  const tick = send(state, { type: "TICK", timeSec: 40, nowMs: 60250, playbackRate: 1 });

  // Wall delta of 60s makes a 35s advance look like normal playback; the controller therefore sends isPaused.
  assert.deepEqual(tick.effect, { type: "PAUSE", groupId: "a" });
});

test("browser order while playing: tick at the target before seeked is a seek, not a stop", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 5.25, nowMs: 250, playbackRate: 1 }).state;
  const tick = send(state, { type: "TICK", timeSec: 40, nowMs: 500, playbackRate: 1 });
  const seeked = send(tick.state, { type: "SEEKED", timeSec: 40, nowMs: 501 });

  assert.equal(tick.effect, null);
  assert.equal(seeked.effect, null);
  assert.equal(getCheckpointStatus(seeked.state, "a"), "passed");
});

test("a paused backward scrub re-arms the stop", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 30, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 2, nowMs: 5000, playbackRate: 1, isPaused: true }).state;

  assert.equal(getCheckpointStatus(state, "a"), "upcoming");
});

test("a small paused position change is noise and never fires", () => {
  let state = setup([group("a", 10)]);
  state = send(state, { type: "TICK", timeSec: 9.9, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "TICK", timeSec: 9.9, nowMs: 50, playbackRate: 1, isPaused: true }).state;
  const result = send(state, { type: "TICK", timeSec: 10.1, nowMs: 90000, playbackRate: 1, isPaused: true });

  assert.equal(result.effect, null);
  assert.equal(getCheckpointStatus(result.state, "a"), "upcoming");
});

test("first tick after resume at 2x with a janky 1s gap is not mistaken for a seek", () => {
  let state = setup([group("a", 10), group("b", 14)]);
  state = send(state, { type: "TICK", timeSec: 9.8, nowMs: 0, playbackRate: 2 }).state;
  state = send(state, { type: "TICK", timeSec: 10.1, nowMs: 100, playbackRate: 2 }).state;
  state = send(state, { type: "PAUSED_AT", timeSec: 10.1 }).state;
  state = send(state, { type: "RESOLVE", groupId: "a", outcome: "answered" }).state;
  state = send(state, { type: "SEEKED", timeSec: 10.1, nowMs: 5000 }).state;
  state = send(state, { type: "PLAYED", nowMs: 5010 }).state;
  const result = send(state, { type: "TICK", timeSec: 14.1, nowMs: 7010, playbackRate: 2 });

  assert.deepEqual(result.effect, { type: "PAUSE", groupId: "b" });
});

test("PLAYED restarts the wall clock after a long pause", () => {
  let state = setup([group("a", 20)]);
  state = send(state, { type: "TICK", timeSec: 5, nowMs: 0, playbackRate: 1 }).state;
  state = send(state, { type: "PLAYED", nowMs: 600000 }).state;
  const result = send(state, { type: "TICK", timeSec: 5.25, nowMs: 600250, playbackRate: 1 });

  assert.equal(result.effect, null);
  assert.equal(result.state.lastTimeSec, 5.25);
});
