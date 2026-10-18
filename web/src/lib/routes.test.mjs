import assert from "node:assert/strict";
import { test } from "node:test";

import { routes } from "./routes.ts";

test("route map không còn route chưa có trang", () => {
  for (const name of ["forgotPassword", "resetPassword", "verifyEmail", "videoPlayer"]) {
    assert.equal(name in routes, false, name);
  }
});
