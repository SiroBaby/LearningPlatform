import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DEFAULT_DISPLAY_TIME_ZONE,
  VIETNAMESE_LOCALE,
  formatVietnameseDate,
  formatVietnameseDateTime,
  formatVietnameseMediumDate,
  formatVietnameseShortDateTime,
} from "./date-time.ts";

const mockDataSource = readFileSync(new URL("./mock-data.ts", import.meta.url), "utf8");

test("formats compact date helpers with the fixed Ho Chi Minh timezone", () => {
  const iso = "2026-03-15T23:30:00.000Z";
  const expectedDate = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  }).format(new Date(iso));
  const expectedShortDateTime = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  }).format(new Date(iso));

  assert.equal(formatVietnameseDate(iso), expectedDate);
  assert.equal(formatVietnameseShortDateTime(iso), expectedShortDateTime);
  assert.equal(formatVietnameseDate(iso), "16/03/2026");
  assert.equal(formatVietnameseShortDateTime(iso), "06:30 16-03");
  assert.equal(formatVietnameseMediumDate(iso), "16 thg 3, 2026");
});

test("formats Vietnamese date time with fixed locale and Ho Chi Minh timezone", () => {
  const iso = "2026-03-15T01:05:00.000Z";
  const expected = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  }).format(new Date(iso));

  assert.equal(formatVietnameseDateTime(iso), expected);
});

test("fixed timezone output differs from UTC for cross-day timestamps", () => {
  const iso = "2026-03-15T23:30:00.000Z";
  const vietnamTime = formatVietnameseDateTime(iso);
  const utcTime = new Intl.DateTimeFormat(VIETNAMESE_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

  assert.notEqual(vietnamTime, utcTime);
});

test("fixed timezone helpers stay stable when runtime timezone changes", () => {
  const iso = "2026-03-15T23:30:00.000Z";
  const previousTimezone = process.env.TZ;

  try {
    process.env.TZ = "UTC";
    const utcRuntimeOutput = [
      formatVietnameseDate(iso),
      formatVietnameseMediumDate(iso),
      formatVietnameseShortDateTime(iso),
      formatVietnameseDateTime(iso),
    ];

    process.env.TZ = "Pacific/Honolulu";
    const alternateRuntimeOutput = [
      formatVietnameseDate(iso),
      formatVietnameseMediumDate(iso),
      formatVietnameseShortDateTime(iso),
      formatVietnameseDateTime(iso),
    ];

    assert.deepEqual(alternateRuntimeOutput, utcRuntimeOutput);
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test("mock data date wrappers use the fixed timezone helpers", () => {
  assert.match(mockDataSource, /export function formatDate\(iso: string\): string \{\s+return formatVietnameseDate\(iso\);/u);
  assert.match(mockDataSource, /export function formatDateTime\(iso: string\): string \{\s+return formatVietnameseShortDateTime\(iso\);/u);
});
