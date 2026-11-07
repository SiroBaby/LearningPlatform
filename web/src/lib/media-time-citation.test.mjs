import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMediaTime, formatTimeCitationLabel } from "./media-time-citation.ts";

test("formats m:ss below one hour", () => {
  assert.equal(formatMediaTime(0), "0:00");
  assert.equal(formatMediaTime(59), "0:59");
  assert.equal(formatMediaTime(60), "1:00");
  assert.equal(formatMediaTime(3599), "59:59");
});

test("uses h:mm:ss from one hour", () => {
  assert.equal(formatMediaTime(3600), "1:00:00");
  assert.equal(formatMediaTime(3725), "1:02:05");
});

test("rounds down fractions and clamps negative or invalid values", () => {
  assert.equal(formatMediaTime(59.99), "0:59");
  assert.equal(formatMediaTime(-5), "0:00");
  assert.equal(formatMediaTime(Number.NaN), "0:00");
});

test("labels a range as Từ ... đến ...", () => {
  assert.equal(formatTimeCitationLabel(65, 130), "Từ 1:05 đến 2:10");
  assert.equal(formatTimeCitationLabel(3599, 3600.5), "Từ 59:59 đến 1:00:00");
  assert.equal(formatTimeCitationLabel(0, 59), "Từ 0:00 đến 0:59");
});

test("labels a single point as Tại when the end is missing or not after the start", () => {
  assert.equal(formatTimeCitationLabel(65), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(65, null), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(65, Number.NaN), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(65, 65), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(65, 30), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(65.9, 65.95), "Tại 1:05");
  assert.equal(formatTimeCitationLabel(-3, -1), "Tại 0:00");
});

test("rounds both ends down at a minute boundary", () => {
  assert.equal(formatTimeCitationLabel(59.9, 60.2), "Từ 0:59 đến 1:00");
});
