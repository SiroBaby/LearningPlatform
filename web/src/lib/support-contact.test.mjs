import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SUPPORT_EMAIL, SUPPORT_MAILTO_HREF } from "./support-contact.ts";

const sectionsSource = readFileSync(new URL("../components/processing/processing-status-sections.tsx", import.meta.url), "utf8");

test("liên hệ hỗ trợ lấy từ hằng số dùng chung", () => {
  assert.equal(SUPPORT_MAILTO_HREF, `mailto:${SUPPORT_EMAIL}`);
  assert.match(sectionsSource, /@\/lib\/support-contact/u);
  assert.doesNotMatch(sectionsSource, /@gmail\.com/u);
});
