import assert from "node:assert/strict";
import { test } from "node:test";

import { getWebPublicOrigin, getWebPublicUrl } from "./public-origin.ts";

const originalEnvironment = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnvironment };
});

test("uses the configured public origin for redirects", () => {
  process.env.NODE_ENV = "production";
  process.env.WEB_PUBLIC_ORIGIN = "https://learningplatform-dev.example.test";
  assert.equal(getWebPublicUrl("/home").toString(), "https://learningplatform-dev.example.test/home");
});

test("allows an explicit local origin fallback only outside production", () => {
  process.env.NODE_ENV = "development";
  delete process.env.WEB_PUBLIC_ORIGIN;
  process.env.WEB_LOCAL_PUBLIC_ORIGIN = "http://localhost:3000";
  assert.equal(getWebPublicOrigin(), "http://localhost:3000");
});

test("fails closed when production origin is missing or malformed", () => {
  process.env.NODE_ENV = "production";
  delete process.env.WEB_PUBLIC_ORIGIN;
  assert.throws(() => getWebPublicOrigin(), /WEB_PUBLIC_ORIGIN must be configured/);
  process.env.WEB_PUBLIC_ORIGIN = "http://0.0.0.0:3000/login";
  assert.throws(() => getWebPublicOrigin(), /must be an origin without/);
});

test("rejects protocol-relative redirect paths", () => {
  process.env.NODE_ENV = "production";
  process.env.WEB_PUBLIC_ORIGIN = "https://learningplatform-dev.example.test";
  assert.throws(() => getWebPublicUrl("//attacker.example"), /absolute path/);
});
