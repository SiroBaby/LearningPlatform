import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRetryAfterSeconds, readPassthroughErrorHeaders } from "./retry-after.ts";

const NOW_MS = Date.parse("2026-09-04T00:00:00Z");

test("parses delta-seconds and HTTP-date", () => {
  assert.equal(parseRetryAfterSeconds("7", NOW_MS), 7);
  assert.equal(parseRetryAfterSeconds("Fri, 04 Sep 2026 00:00:30 GMT", NOW_MS), 30);
  assert.equal(parseRetryAfterSeconds("Fri, 04 Sep 2026 00:00:00 GMT", NOW_MS + 5000), 0);
});

test("rejects absent, negative and malformed values", () => {
  for (const value of [null, "", "-3", "abc", "1.5", "99999999"]) {
    assert.equal(parseRetryAfterSeconds(value, NOW_MS), null, String(value));
  }
});

test("forwards only a normalized Retry-After and drops every other header", () => {
  const headers = new Headers({
    "retry-after": "12",
    "set-cookie": "lp_access=secret",
    "x-internal-trace": "abc",
    "content-type": "application/json",
  });

  assert.deepEqual(readPassthroughErrorHeaders(headers, NOW_MS), { "Retry-After": "12" });
  assert.deepEqual(readPassthroughErrorHeaders(new Headers({ "retry-after": "nope" }), NOW_MS), {});
  assert.deepEqual(readPassthroughErrorHeaders(new Headers({ "retry-after": "999999" }), NOW_MS), { "Retry-After": "3600" });
});
