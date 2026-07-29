import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DISPLAY_TIME_ZONE,
  VIETNAMESE_LOCALE,
  formatVietnameseDateTime,
} from "./date-time.ts";

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
