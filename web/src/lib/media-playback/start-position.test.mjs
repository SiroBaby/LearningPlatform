import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStartSec } from "./start-position.ts";

test("accepts a non-negative integer and clamps it to the duration", () => {
  assert.equal(parseStartSec("0", 100), 0);
  assert.equal(parseStartSec("42", 100), 42);
  assert.equal(parseStartSec("500", 100), 99);
  assert.equal(parseStartSec("5", 0), 0);
  assert.equal(parseStartSec("500", null), 500);
});

test("ignores missing, negative, fractional, repeated and malformed values", () => {
  for (const value of [undefined, "", "-1", "1.5", "abc", "1e3", ["5", "6"], "9999999999"]) {
    assert.equal(parseStartSec(value, 100), undefined, JSON.stringify(value));
  }
});
