import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "upload-workspace-utils.ts"), "utf8");

test("declares the supported document and media types", () => {
  assert.match(source, /type: "PDF"/u);
  assert.match(source, /type: "TEXT"/u);
  assert.match(source, /type: "AUDIO"/u);
  assert.match(source, /type: "VIDEO"/u);
  assert.match(source, /extension: "mp3"/u);
  assert.match(source, /extension: "mp4"/u);
});

test("keeps media hard caps and duration limit aligned with the server policy", () => {
  assert.match(source, /MAX_MP3_SIZE_BYTES = 300 \* 1024 \* 1024/u);
  assert.match(source, /MAX_MP4_SIZE_BYTES = 500 \* 1024 \* 1024/u);
  assert.match(source, /MAX_MEDIA_DURATION_SECONDS = 2 \* 60 \* 60/u);
  assert.match(source, /maxSizeLabel: "300 MiB"/u);
  assert.match(source, /maxSizeLabel: "500 MiB"/u);
});

test("validates extension, MIME type and size before upload", () => {
  assert.match(source, /if \(!policy\)/u);
  assert.match(source, /mime.length > 0 && !policy.acceptedMimeTypes.includes\(mime\)/u);
  assert.match(source, /file.size > policy.maxSizeBytes/u);
  assert.match(source, /Tệp \$\{policy.label\} vượt giới hạn \$\{policy.maxSizeLabel\}/u);
});

test("keeps the retry warning visible in the upload policy copy", () => {
  const pickerSource = readFileSync(resolve(dirname(import.meta.filename), "upload-picker-section.tsx"), "utf8");

  assert.match(pickerSource, /tải lại.*bắt đầu từ đầu/u);
  assert.match(pickerSource, /chưa hỗ trợ tiếp tục từ phần đã tải/u);
});

test("keeps media types hidden until the server enables the feature", () => {
  const pageSource = readFileSync(resolve(dirname(import.meta.filename), "../../app/upload/page.tsx"), "utf8");
  const pickerSource = readFileSync(resolve(dirname(import.meta.filename), "upload-picker-section.tsx"), "utf8");
  const formSource = readFileSync(resolve(dirname(import.meta.filename), "upload-workspace-form.tsx"), "utf8");
  const statusSource = readFileSync(resolve(dirname(import.meta.filename), "upload-status-panel.tsx"), "utf8");

  assert.match(pageSource, /process\.env\.MEDIA_UPLOADS_ENABLED === "true"/u);
  assert.match(pageSource, /<UploadWorkspace isMediaUploadEnabled=\{isMediaUploadEnabled\}/u);
  assert.match(pickerSource, /isMediaUploadEnabled: boolean/u);
  assert.match(pickerSource, /accept=\{isMediaUploadEnabled/u);
  assert.match(formSource, /<UploadSelectionBadges isMediaUploadEnabled=\{isMediaUploadEnabled\}/u);
  assert.match(statusSource, /isMediaUploadEnabled: boolean/u);
});
