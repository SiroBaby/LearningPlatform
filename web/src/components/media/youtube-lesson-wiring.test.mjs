import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const webRoot = resolve(dirname(import.meta.filename), "../../..");
const readSource = (path) => readFileSync(resolve(webRoot, path), "utf8");

const YOUTUBE_FILES = [
  "src/components/media/use-youtube-playback.ts",
  "src/components/media/youtube-player.tsx",
  "src/components/upload/youtube-source-section.tsx",
  "src/components/upload/youtube-confirm-section.tsx",
  "src/components/upload/subtitle-preview-table.tsx",
  "src/components/upload/subtitle-file.ts",
  "src/lib/media-playback/youtube-iframe-api.ts",
  "src/lib/media-playback/youtube-player-adapter.ts",
];

test("the lesson picks its player from a source union and both players share one question flow", () => {
  const source = readSource("src/components/media/media-lesson.tsx");

  assert.match(source, /\{ readonly kind: "html"; readonly mediaKind: MediaPlayerKind \}/u);
  assert.match(source, /\{ readonly kind: "youtube"; readonly videoId: string \}/u);
  assert.equal((source.match(/useMediaCheckpoints\(/gu) ?? []).length, 1);
  assert.equal((source.match(/useMediaPlayback\(/gu) ?? []).length, 1);
  assert.equal((source.match(/useYouTubePlayback\(/gu) ?? []).length, 1);
  assert.match(source, /function YouTubeLesson[\s\S]*useYouTubePlayback\(/u);
  assert.match(source, /function HtmlMediaLesson[\s\S]*useMediaPlayback\(/u);
  assert.match(source, /kind="VIDEO"/u);
});

test("a YouTube lesson never requests a signed playback URL", () => {
  const source = readSource("src/components/media/use-youtube-playback.ts");

  assert.doesNotMatch(source, /useMediaPlayback|createPhase0PlaybackUrl|playback-url/u);
  assert.doesNotMatch(readSource("src/components/media/youtube-player.tsx"), /useMediaPlayback/u);
});

test("the adapter is created once per lesson and the player effect depends only on adapter, video and retry", () => {
  const source = readSource("src/components/media/use-youtube-playback.ts");

  assert.match(source, /const \[adapter\] = useState<YouTubePlayerAdapter>\(\(\) => createYouTubePlayerAdapter\(\)\)/u);
  assert.match(source, /\}, \[adapter, videoId, attempt\]\);/u);
  assert.match(source, /titleRef\.current/u);
  assert.match(source, /startSecRef\.current/u);
  assert.match(source, /const retry = useCallback\([\s\S]*?\}, \[\]\);/u);
  assert.match(source, /const focusPlayer = useCallback\([\s\S]*?\}, \[\]\);/u);
  assert.equal((source.match(/createYouTubePlayerAdapter\(/gu) ?? []).length, 1);
});

test("the player is torn down and the adapter detached on unmount, remount and failure", () => {
  const source = readSource("src/components/media/use-youtube-playback.ts");

  assert.match(source, /isCancelled = true;[\s\S]*adapter\.detachPlayer\(\);[\s\S]*player\?\.destroy\(\)[\s\S]*host\.replaceChildren\(\)/u);
  assert.match(source, /const fail = [\s\S]*adapter\.detachPlayer\(\);/u);
  assert.match(source, /onStateChange: \(event\): void => \{\s*if \(!isCancelled\) adapter\.handleStateChange\(event\.data\);/u);
});

test("the embed uses the privacy host, the page origin and inline playback, and keeps the referrer", () => {
  const source = readSource("src/components/media/use-youtube-playback.ts");

  assert.match(source, /https:\/\/www\.youtube-nocookie\.com/u);
  assert.match(source, /origin: window\.location\.origin/u);
  assert.match(source, /playsinline: 1/u);
  assert.match(source, /rel: 0/u);
  for (const path of YOUTUBE_FILES) assert.doesNotMatch(readSource(path), /referrerpolicy|referrerPolicy|no-referrer/iu, path);
});

test("player errors and a failed API load show the agreed states", () => {
  const hook = readSource("src/components/media/use-youtube-playback.ts");

  assert.match(hook, /classifyYouTubeErrorCode\(event\.data\)/u);
  assert.match(hook, /\.catch\(\(\) => fail\("load-failed"\)\)/u);
  assert.match(hook, /isSourceUnavailable: errorKind === "unavailable"/u);
  assert.match(readSource("src/components/media/media-lesson.tsx"), /isSourceUnavailable=\{playback\.isSourceUnavailable\}/u);
  assert.match(readSource("src/components/media/youtube-player.tsx"), /playback\.canRetry \? \(/u);
});

test("a refused resume never becomes an unhandled rejection", () => {
  const source = readSource("src/components/media/use-media-checkpoints.ts");

  assert.match(source, /adapter\.play\(\)\.catch\(\(\) => undefined\)\.finally\(/u);
});

test("desktop keeps the checkpoint list under the player while the panel stays tall on the right, and mobile order is kept", () => {
  const source = readSource("src/components/media/media-lesson.tsx");

  assert.match(source, /lg:grid-rows-\[auto_1fr\]/u);
  assert.match(source, /lg:items-start/u);
  assert.match(source, /lg:col-start-2 lg:row-span-2 lg:row-start-1/u);
  assert.match(source, /lg:col-start-1 lg:row-start-1/u);
  assert.match(source, /lg:col-start-1 lg:row-start-2/u);
  const playerAt = source.indexOf("{player}");
  const panelAt = source.indexOf("<CheckpointPanel");
  const listAt = source.indexOf("<CheckpointList");
  assert.ok(playerAt > 0 && playerAt < panelAt && panelAt < listAt, "DOM order must be player, panel, list");
});

test("the document page opens a READY YouTube lesson with its video id", () => {
  const source = readSource("src/components/library/document-detail.tsx");

  assert.match(source, /type === "YOUTUBE" && youtubeVideoId !== null\) return \{ kind: "youtube", videoId: youtubeVideoId \}/u);
  assert.match(source, /source=\{lessonSource\}/u);
  assert.match(source, /document\.status === "READY" && lessonSource !== null/u);
  assert.match(source, /"Xem video"/u);
  assert.match(source, /YOUTUBE: "YouTube"/u);
});

test("library, processing and quiz result recognise YouTube documents", () => {
  assert.match(readSource("src/components/library/library-browser.tsx"), /case "YOUTUBE":\s*return "youtube"/u);
  assert.match(readSource("src/components/library/library-browser.tsx"), /<option value="YOUTUBE">YouTube<\/option>/u);
  assert.match(readSource("src/components/processing/processing-status-utils.ts"), /case "YOUTUBE":\s*return "youtube"/u);
  assert.match(readSource("src/components/ui/badge.tsx"), /youtube: "YouTube"/u);
  assert.match(readSource("src/app/quiz/[id]/result/[attemptId]/page.tsx"), /document\.type === "VIDEO" \|\| document\.type === "YOUTUBE"\) return WATCH_LINK_LABEL/u);
});

test("the upload page offers YouTube only when the server flag is the exact string true", () => {
  const page = readSource("src/app/upload/page.tsx");
  const form = readSource("src/components/upload/upload-workspace-form.tsx");

  assert.match(page, /process\.env\.YOUTUBE_LESSONS_ENABLED === "true"/u);
  assert.match(page, /isYoutubeLessonsEnabled=\{isYoutubeLessonsEnabled\}/u);
  assert.match(form, /isYoutubeLessonsEnabled \? \(\s*<UploadSourceSwitch/u);
});

test("confirm stays disabled until the rights box is ticked and a preview exists", () => {
  const workspace = readSource("src/components/upload/upload-workspace.tsx");
  const section = readSource("src/components/upload/youtube-confirm-section.tsx");

  assert.match(workspace, /const canConfirmYoutube = isYoutube\s*&& subtitlePreview !== null\s*&& isRightsConfirmed/u);
  assert.match(workspace, /if \(!documentId \|\| !canConfirmYoutube\)/u);
  assert.match(workspace, /runConfirm\(documentId, \{ rightsConfirmed: true \}\)/u);
  assert.match(section, /disabled=\{!canConfirm\}/u);
  assert.match(section, /Tôi có quyền dùng video và phụ đề này, và phụ đề khớp với video\./u);
});

test("the YouTube flow runs create, upload, preview and then confirm, never confirming by itself", () => {
  const workspace = readSource("src/components/upload/upload-workspace.tsx");

  assert.match(workspace, /if \(isYoutube\) \{\s*await runPreview\(upload\.documentId\);\s*return;\s*\}\s*await runConfirm\(upload\.documentId\);/u);
  assert.match(workspace, /\.\.\.\(isYoutube \? \{ youtubeUrl: youtubeUrl\.trim\(\) \} : \{\}\)/u);
});

test("subtitle text is rendered as plain text and no new module reads session storage or logs", () => {
  for (const path of YOUTUBE_FILES) {
    const source = readSource(path);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/u, path);
    assert.doesNotMatch(source, /sessionStorage|localStorage/u, path);
  }
  assert.match(readSource("src/components/upload/subtitle-preview-table.tsx"), /\{cue\.text\}/u);
});

test("new YouTube modules have no phase-based names", () => {
  for (const path of YOUTUBE_FILES) assert.doesNotMatch(readSource(path), /Phase0[A-Z]\w*(YouTube|Youtube|Subtitle)|(YouTube|Youtube|Subtitle)\w*Phase0/u, path);
});
