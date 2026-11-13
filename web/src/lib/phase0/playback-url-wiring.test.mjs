import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const webRoot = resolve(dirname(import.meta.filename), "../../..");
const readSource = (path) => readFileSync(resolve(webRoot, path), "utf8");

test("the playback BFF route is dynamic, uncached and POST only", () => {
  const source = readSource("src/app/api/phase0/documents/[id]/playback-url/route.ts");

  assert.match(source, /export const dynamic = "force-dynamic"/u);
  assert.match(source, /export async function POST/u);
  assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/u);
  assert.match(source, /"Cache-Control", NO_STORE/u);
  assert.match(source, /catch \{[\s\S]*"Cache-Control": NO_STORE/u);
  assert.match(source, /\/documents\/\$\{encodeURIComponent\(id\)\}\/playback-url/u);
});

test("the backend client forwards only the validated Retry-After header on errors", () => {
  const source = readSource("src/lib/phase0/backend-client.ts");

  assert.match(source, /readPassthroughErrorHeaders\(response\.headers, Date\.now\(\)\)/u);
  assert.equal((source.match(/status: response\.status, headers/gu) ?? []).length, 2);
});

test("the media element never sets crossOrigin so no storage CORS is needed", () => {
  for (const path of ["src/components/media/media-player.tsx", "src/components/media/use-media-playback.ts"]) {
    assert.doesNotMatch(readSource(path), /crossOrigin/u, path);
  }
});

test("playback code never logs", () => {
  for (const path of ["src/components/media/use-media-playback.ts", "src/lib/media-playback/apply-source.ts"]) {
    assert.doesNotMatch(readSource(path), /console\./u, path);
  }
});
