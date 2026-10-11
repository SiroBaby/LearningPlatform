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
