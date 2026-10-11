import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const directory = dirname(import.meta.filename);
const source = (relativePath) => readFileSync(resolve(directory, relativePath), "utf8");

test("processing polling stops on a stop status and on a missing document", () => {
  const hook = source("../../components/processing/processing-status-utils.ts");

  assert.match(hook, /if \(isPollingStopStatus\(nextDocument\.status\)\) \{\s*setIsLoading\(false\);\s*return;\s*\}/u);
  assert.match(
    hook,
    /if \(isDocumentNotFoundError\(pollError\)\) \{\s*setIsDocumentMissing\(true\);\s*setIsLoading\(false\);\s*return;\s*\}/u,
  );
});

test("library list hides DELETING documents before presenting them", () => {
  const browser = source("../../components/library/library-browser.tsx");

  assert.match(browser, /setDocuments\(excludeDeletingDocuments\(response\)\.map\(toPresentationDocument\)\)/u);
});

test("document detail page treats a DELETING document as not found", () => {
  const page = source("../../app/library/[id]/page.tsx");

  assert.match(page, /if \(isDocumentDeleting\(document\)\) \{\s*notFound\(\);\s*\}/u);
});

test("delete button ignores repeated confirmation while a deletion is in flight", () => {
  const button = source("../../components/library/delete-document-button.tsx");

  assert.match(
    button,
    /const confirmDeletion = useCallback\(async \(\): Promise<void> => \{\s*if \(isDeletingRef\.current\) \{\s*return;\s*\}\s*isDeletingRef\.current = true;/u,
  );
  assert.match(button, /setDeletionError\(getDocumentDeletionErrorMessage\(error\)\);\s*isDeletingRef\.current = false;/u);
});

test("delete dialog returns focus to the confirm button after a failed deletion", () => {
  const button = source("../../components/library/delete-document-button.tsx");

  assert.match(
    button,
    /if \(shouldFocusDeletionConfirm\(\{ deletionError, isDeleting \}\)\) \{\s*confirmButtonRef\.current\?\.focus\(\);\s*\}\s*\}, \[deletionError, isDeleting\]\);/u,
  );
  assert.match(button, /<Button\s+ref=\{confirmButtonRef\}\s+type="button"\s+variant="danger"/u);
});
