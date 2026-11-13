import assert from "node:assert/strict";
import { test } from "node:test";

import { SUBTITLE_PREVIEW_PAGE_SIZE, getSubtitlePreviewPage } from "./subtitle-preview-paging.ts";

const rows = (count) => Array.from({ length: count }, (_, index) => index);

test("pages hold 100 rows", () => {
  assert.equal(SUBTITLE_PREVIEW_PAGE_SIZE, 100);
  const page = getSubtitlePreviewPage(rows(250), 0);

  assert.equal(page.rows.length, 100);
  assert.equal(page.pageCount, 3);
  assert.equal(page.firstRowNumber, 1);
});

test("the last page holds the remainder", () => {
  const page = getSubtitlePreviewPage(rows(250), 2);

  assert.deepEqual(page.rows, rows(250).slice(200));
  assert.equal(page.firstRowNumber, 201);
});

test("an exact multiple does not add an empty page", () => {
  assert.equal(getSubtitlePreviewPage(rows(200), 0).pageCount, 2);
});

test("an out-of-range or invalid index is clamped", () => {
  assert.equal(getSubtitlePreviewPage(rows(250), 99).pageIndex, 2);
  assert.equal(getSubtitlePreviewPage(rows(250), -3).pageIndex, 0);
  assert.equal(getSubtitlePreviewPage(rows(250), Number.NaN).pageIndex, 0);
});

test("no rows still gives one empty page", () => {
  const page = getSubtitlePreviewPage([], 0);

  assert.equal(page.pageCount, 1);
  assert.deepEqual(page.rows, []);
  assert.equal(page.firstRowNumber, 0);
});
