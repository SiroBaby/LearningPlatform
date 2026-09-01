import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "session.ts"), "utf8");

test("checks authenticated sessions through the internal auth route", () => {
  assert.match(source, /path: "\/internal\/v1\/auth\/me"/u);
  assert.doesNotMatch(source, /path: "\/api\/v1\/auth\/me"/u);
});
