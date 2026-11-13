import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCheckpointGroups } from "./checkpoint-schedule.ts";

const question = (id, servedIndex, startSec, endSec) => ({
  id,
  servedIndex,
  timeRange: endSec === null ? null : { startSec, endSec },
});

test("places the checkpoint at endSec of the time range", () => {
  const groups = buildCheckpointGroups([question("a", 0, 10, 30)], { durationSec: 120 });

  assert.deepEqual(groups, [{ id: "a", atSec: 30, startSec: 10, questionIds: ["a"] }]);
});

test("clamps a checkpoint near or past the end to duration minus the guard", () => {
  const groups = buildCheckpointGroups(
    [question("a", 0, 90, 119.9), question("b", 1, 100, 400)],
    { durationSec: 120, groupWindowSec: 0 },
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0].atSec, 119.5);
  assert.deepEqual(groups[0].questionIds, ["a", "b"]);
});

test("never clamps below zero for a very short media", () => {
  const groups = buildCheckpointGroups([question("a", 0, 0, 1)], { durationSec: 0.2 });

  assert.equal(groups[0].atSec, 0);
});

test("keeps raw endSec while the duration is unknown", () => {
  const groups = buildCheckpointGroups([question("a", 0, 0, 400)], { durationSec: null });

  assert.equal(groups[0].atSec, 400);
});

test("skips questions without a valid time range", () => {
  const groups = buildCheckpointGroups(
    [
      question("none", 0, 0, null),
      question("backwards", 1, 20, 10),
      question("negative", 2, -5, 10),
      { id: "nan", servedIndex: 3, timeRange: { startSec: 0, endSec: Number.NaN } },
      question("ok", 4, 0, 10),
    ],
    { durationSec: 100 },
  );

  assert.deepEqual(groups.map((group) => group.id), ["ok"]);
});

test("groups questions within 2 seconds and uses the latest atSec", () => {
  const groups = buildCheckpointGroups(
    [question("a", 0, 0, 30), question("b", 1, 5, 31), question("c", 2, 8, 32), question("d", 3, 9, 33)],
    { durationSec: 200 },
  );

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { id: "a", atSec: 32, startSec: 0, questionIds: ["a", "b", "c"] });
  assert.equal(groups[1].id, "d");
});

test("uses the earliest start of the group for go-to-part", () => {
  const groups = buildCheckpointGroups(
    [question("a", 0, 20, 31), question("b", 1, 12, 30)],
    { durationSec: 200 },
  );

  assert.equal(groups[0].startSec, 12);
});

test("orders question ids by served index and groups by time", () => {
  const groups = buildCheckpointGroups(
    [question("late", 0, 0, 100), question("x", 3, 0, 20), question("y", 1, 0, 20.5)],
    { durationSec: 200 },
  );

  assert.deepEqual(groups.map((group) => group.id), ["x", "late"]);
  assert.deepEqual(groups[0].questionIds, ["y", "x"]);
});

test("ties on atSec keep the lower served index first", () => {
  const groups = buildCheckpointGroups(
    [question("b", 1, 0, 50), question("a", 0, 0, 50)],
    { durationSec: 200 },
  );

  assert.deepEqual(groups.map((group) => group.id), ["a"]);
  assert.deepEqual(groups[0].questionIds, ["a", "b"]);
});

test("group ids stay stable when the duration arrives later", () => {
  const input = [question("a", 0, 0, 30), question("b", 1, 0, 80), question("c", 2, 0, 81)];
  const before = buildCheckpointGroups(input, { durationSec: null });
  const after = buildCheckpointGroups(input, { durationSec: 200 });

  assert.deepEqual(before.map((group) => group.id), after.map((group) => group.id));
});

test("returns no groups for no questions", () => {
  assert.deepEqual(buildCheckpointGroups([], { durationSec: 10 }), []);
});
