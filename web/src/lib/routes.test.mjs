import assert from "node:assert/strict";
import { test } from "node:test";

import { routes } from "./routes.ts";

test("route map không còn route chưa có trang", () => {
  for (const name of ["forgotPassword", "resetPassword", "verifyEmail", "videoPlayer"]) {
    assert.equal(name in routes, false, name);
  }
});

test("libraryDocumentAt thêm vị trí bắt đầu là số giây nguyên không âm", () => {
  assert.equal(routes.libraryDocumentAt("doc-1", 125), "/library/doc-1?t=125");
  assert.equal(routes.libraryDocumentAt("doc-1", 12.9), "/library/doc-1?t=12");
  assert.equal(routes.libraryDocumentAt("doc-1", -5), "/library/doc-1?t=0");
});
