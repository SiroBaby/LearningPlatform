import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const webRoot = resolve(dirname(import.meta.filename), "../../..");
const readSource = (path) => readFileSync(resolve(webRoot, path), "utf8");

const NEW_MODULES = [
  "src/components/media/media-lesson.tsx",
  "src/components/media/checkpoint-panel.tsx",
  "src/components/media/checkpoint-question.tsx",
  "src/components/media/checkpoint-list.tsx",
  "src/components/media/use-media-checkpoints.ts",
  "src/components/media/use-checkpoint-quiz.ts",
  "src/components/media/use-checkpoint-progress.ts",
  "src/lib/media-checkpoints/checkpoint-engine.ts",
  "src/lib/media-checkpoints/checkpoint-schedule.ts",
  "src/lib/media-checkpoints/checkpoint-progress.ts",
  "src/components/media/use-youtube-playback.ts",
  "src/components/media/youtube-player.tsx",
  "src/lib/media-playback/youtube-iframe-api.ts",
  "src/lib/media-playback/youtube-player-adapter.ts",
  "src/lib/media-playback/youtube-playback-errors.ts",
  "src/lib/media-playback/youtube-video-id.ts",
  "src/lib/media-playback/youtube-ready-watchdog.ts",
  "src/lib/media-playback/subtitle-preview-paging.ts",
];

test("the media player only renders; the lesson owns both hooks", () => {
  assert.doesNotMatch(readSource("src/components/media/media-player.tsx"), /useMediaPlayback\(/u);
  const lesson = readSource("src/components/media/media-lesson.tsx");
  assert.match(lesson, /useMediaPlayback\(/u);
  assert.match(lesson, /useMediaCheckpoints\(/u);
});

test("the document page mounts the lesson with the quiz and duration", () => {
  const source = readSource("src/components/library/document-detail.tsx");

  assert.match(source, /<MediaLesson/u);
  assert.match(source, /quizId=\{quizDiscovery\?\.quizId \?\? null\}/u);
  assert.match(source, /durationSec=\{document\.durationSec\}/u);
});

test("new checkpoint modules have stable names, no logging and no crossOrigin", () => {
  for (const path of NEW_MODULES) {
    const source = readSource(path);
    assert.doesNotMatch(source, /Phase0[A-Z]\w*Checkpoint|Checkpoint\w*Phase0/u, path);
    assert.doesNotMatch(source, /console\./u, path);
    assert.doesNotMatch(source, /crossOrigin/u, path);
  }
});

test("saved checkpoint progress is read only inside an effect", () => {
  const source = readSource("src/components/media/use-checkpoint-progress.ts");

  assert.match(source, /useEffect\(\(\) => \{[\s\S]*sessionStorage[\s\S]*\}, \[quizId\]\)/u);
  assert.doesNotMatch(source, /useState\([^)]*sessionStorage/u);
});

test("checkpoint feedback is requested only by the check action", () => {
  const source = readSource("src/components/media/use-media-checkpoints.ts");

  assert.equal((source.match(/loadPracticeFeedback\(/gu) ?? []).length, 1);
  assert.match(source, /const checkAnswer = useCallback[\s\S]*loadPracticeFeedback/u);
});

test("the quiz result page links time citations back to the media only for playable documents", () => {
  const source = readSource("src/app/quiz/[id]/result/[attemptId]/page.tsx");

  assert.match(source, /getPhase0DocumentServer\(documentId\)/u);
  assert.match(source, /routes\.libraryDocumentAt\(attempt\.documentId/u);
  assert.match(source, /document\.status !== "READY"\) return null/u);
  assert.match(source, /catch \{\s*return null;/u);
});

test("the controller tells the engine when playback is paused, restarts the clock on play and gates frames on swaps", () => {
  const source = readSource("src/components/media/use-media-checkpoints.ts");

  assert.match(source, /isPaused: adapter\.isPaused\(\)/u);
  assert.match(source, /type: "PLAYED"/u);
  assert.match(source, /adapter\.isSwapPending\(\)/u);
  assert.match(source, /decideNativePlayOutcome\(/u);
  assert.doesNotMatch(source, /Date\.now\(\)/u);
});

test("groups are applied to the engine once per groups change, through a stable dispatch", () => {
  const source = readSource("src/components/media/use-media-checkpoints.ts");

  assert.equal((source.match(/type: "GROUPS_CHANGED"/gu) ?? []).length, 1);
  assert.match(source, /dispatchRef\.current\(\{ type: "GROUPS_CHANGED", groups \}\);[\s\S]*?\}, \[groups, hasGroups, progress\.isRestored\]\);/u);
  assert.doesNotMatch(source, /\}, \[[^\]]*dispatchEngine[^\]]*\]\);\s*\n\s*\n\s*const \{ persist \}/u);
});

test("the controller keeps per-render function identities out of effect and engine deps", () => {
  const source = readSource("src/components/media/use-media-checkpoints.ts");

  assert.match(source, /resetFeedbackRef\.current\(/u);
  assert.match(source, /const cancelPendingFeedback = useCallback\([\s\S]*?\}, \[\]\);/u);
  assert.match(source, /\}, \[adapter, cancelPendingFeedback, focusMedia\]\);/u);
  assert.match(source, /keepViewIfUnchanged\(/u);
});
