import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const pageSource = readFileSync(resolve(dirname(import.meta.filename), "page.tsx"), "utf8");

test("study plan route renders the learner shell and review queue", () => {
  assert.match(pageSource, /export default function StudyPlanPage/u);
  assert.match(pageSource, /title: "Kế hoạch học"/u);
  assert.match(pageSource, /<LearnerShell/u);
  assert.match(pageSource, /<ReviewPageContent \/>/u);
});
