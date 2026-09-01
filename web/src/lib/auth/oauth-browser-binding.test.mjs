import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  createOAuthBrowserBinding,
  matchesOAuthBrowserBinding,
} from "./oauth-browser-binding.ts";

const directory = dirname(import.meta.filename);
const startSource = readFileSync(resolve(directory, "../../app/auth/google/start/route.ts"), "utf8");
const callbackSource = readFileSync(resolve(directory, "../../app/auth/google/callback/route.ts"), "utf8");
const adrSource = readFileSync(resolve(directory, "../../../../docs/adr/0024-google-oauth-bff-identity.md"), "utf8");

test("rejects a callback with a missing browser binding", () => {
  assert.equal(matchesOAuthBrowserBinding(undefined, "state-value"), false);
});

test("rejects a callback whose binding belongs to another transaction", () => {
  const binding = createOAuthBrowserBinding("state-value");
  assert.equal(matchesOAuthBrowserBinding(binding, "different-state"), false);
});

test("accepts the binding created for the same OAuth transaction", () => {
  const binding = createOAuthBrowserBinding("state-value");
  assert.equal(matchesOAuthBrowserBinding(binding, "state-value"), true);
});

test("binds the callback to the initiating browser before exchanging code", () => {
  assert.match(startSource, /createOAuthBrowserBinding\(state\)/u);
  assert.match(startSource, /httpOnly: true/u);
  assert.match(startSource, /sameSite: "lax"/u);
  assert.match(callbackSource, /cookies\(\)\)\.get\(OAUTH_BROWSER_BINDING_COOKIE\)/u);
  assert.match(callbackSource, /if \(!matchesOAuthBrowserBinding\(browserBinding, state\)\)/u);
  assert.match(
    callbackSource,
    /if \(!matchesOAuthBrowserBinding\(browserBinding, state\)\) \{[\s\S]*?return redirectToLogin\(\);[\s\S]*?\}\s+const response = await requestAuthBackend/u,
  );
});

test("clears the browser binding on callback terminal paths to prevent replay", () => {
  assert.match(callbackSource, /function redirectToLogin\(\): Response/u);
  assert.match(callbackSource, /redirect\.cookies\.set\(OAUTH_BROWSER_BINDING_COOKIE, "",/u);
  assert.match(callbackSource, /maxAge: 0/u);
  assert.match(callbackSource, /path: OAUTH_BROWSER_BINDING_PATH/u);
});

test("keeps the ADR aligned with the Nest global-prefix exclusion", () => {
  assert.match(adrSource, /`POST \/internal\/v1\/auth\/google\/start`/u);
  assert.match(adrSource, /`GET \/internal\/v1\/auth\/me`/u);
  assert.doesNotMatch(adrSource, /\/api\/v1\/internal\/auth/u);
});
