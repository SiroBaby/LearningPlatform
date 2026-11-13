import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const directory = dirname(import.meta.filename);
const source = (relativePath) => readFileSync(resolve(directory, relativePath), "utf8");

test("document retry BFF forwards the dedicated POST command", () => {
  const route = source("../../app/api/phase0/documents/[id]/retry/route.ts");

  assert.match(route, /export async function POST/u);
  assert.match(route, /proxyPhase0Request/u);
  assert.match(route, /method: "POST"/u);
  assert.match(route, /`\/documents\/\$\{encodeURIComponent\(id\)\}\/retry`/u);
  assert.doesNotMatch(route, /confirm/u);
});

test("document BFF forwards DELETE to the owned document path", () => {
  const route = source("../../app/api/phase0/documents/[id]/route.ts");

  assert.match(route, /export async function GET/u);
  assert.match(route, /export async function DELETE/u);
  assert.match(route, /proxyPhase0Request\(\{ method: "DELETE", path: `\/documents\/\$\{encodeURIComponent\(id\)\}` \}\)/u);
  assert.match(source("./route-handler.ts"), /readonly method: "GET" \| "POST" \| "DELETE";/u);
  assert.match(source("./backend-client.ts"), /readonly method: "GET" \| "POST" \| "DELETE";/u);
  assert.match(source("../auth/backend-client.ts"), /readonly method: "GET" \| "POST" \| "PATCH" \| "DELETE";/u);
});

test("quiz attempts BFF keeps GET history separate from attempt submission", () => {
  const route = source("../../app/api/phase0/quizzes/[id]/attempts/route.ts");

  assert.match(route, /export async function GET/u);
  assert.match(route, /method: "GET"/u);
  assert.match(route, /`\/quizzes\/\$\{encodeURIComponent\(id\)\}\/attempts`/u);
  assert.match(route, /export async function POST/u);
});

test("confirm BFF forwards an optional JSON body and rejects a malformed one", () => {
  const route = source("../../app/api/phase0/documents/[id]/confirm/route.ts");
  const handler = source("./route-handler.ts");

  assert.match(route, /proxyPhase0OptionalJsonPost\(`\/documents\/\$\{encodeURIComponent\(id\)\}` \+ "\/confirm", request\)/u);
  assert.match(handler, /export async function proxyPhase0OptionalJsonPost/u);
  assert.match(handler, /text\.trim\(\)\.length === 0[\s\S]*proxyPhase0Request\(\{ method: "POST", path \}\)/u);
  assert.match(handler, /JSON\.parse\(text\)[\s\S]*status: 400/u);
});

test("subtitle preview BFF is a POST with its own longer timeout, below the client timeout", () => {
  const route = source("../../app/api/phase0/documents/[id]/subtitle-preview/route.ts");
  const clientSource = source("./client.ts");

  assert.match(route, /export async function POST/u);
  assert.match(route, /`\/documents\/\$\{encodeURIComponent\(id\)\}\/subtitle-preview`/u);
  assert.match(route, /timeoutMs: SUBTITLE_PREVIEW_TIMEOUT_MS/u);
  const serverTimeout = Number(/SUBTITLE_PREVIEW_TIMEOUT_MS = ([\d_]+)/u.exec(route)?.[1].replaceAll("_", ""));
  const clientTimeout = Number(/SUBTITLE_PREVIEW_TIMEOUT_MS = ([\d_]+)/u.exec(clientSource)?.[1].replaceAll("_", ""));
  assert.ok(serverTimeout > 10_000);
  assert.ok(clientTimeout > serverTimeout);
  assert.match(source("./backend-client.ts"), /readonly timeoutMs\?: number;/u);
  assert.match(source("./route-handler.ts"), /readonly timeoutMs\?: number;/u);
});
