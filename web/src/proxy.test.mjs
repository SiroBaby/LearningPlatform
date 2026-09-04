import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "proxy.ts"), "utf8");
const legacyOwnerHeader = ["X-User", "Id"].join("-");

test("validates private-route cookies through the mTLS backend client", () => {
  assert.match(source, /requestAuthBackend/u);
  assert.match(source, /authorization: `Bearer \$\{accessToken\}`/u);
  assert.match(source, /path: "\/internal\/v1\/auth\/me"/u);
  assert.match(source, /response\.status === 401/u);
  assert.match(source, /createHash\("sha256"\)/u);
  assert.match(source, /Number\.isFinite\(new Date\(value\)\.getTime\(\)\)/u);
  assert.doesNotMatch(source, /fetch\(new URL\("\/api\/v1\/auth\/me"/u);
  assert.doesNotMatch(source, new RegExp(legacyOwnerHeader, "u"));
});
