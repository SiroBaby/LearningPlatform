import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { phase0DocumentProcessingFailureCodes } from "./contracts.ts";
import { isRetryableDocumentFailureCode } from "./document-failure.ts";

const BACKEND_CONTRACT_PATH = new URL(
  "../../../../app/src/modules/ai/contracts/document-processing-result.ts",
  import.meta.url,
);

function readBackendContract() {
  return readFileSync(BACKEND_CONTRACT_PATH, "utf8");
}

function readBackendFailureCodes(source) {
  const enumBody = source.match(/export enum DocumentProcessingFailureCode \{([^}]*)\}/u)?.[1];
  assert.ok(enumBody, "Không tìm thấy enum DocumentProcessingFailureCode ở backend.");
  const memberLines = enumBody.split("\n").map((line) => line.trim()).filter(Boolean);
  const codes = memberLines.map((line) => line.match(/^([A-Z0-9_]+) = '\1',?$/u)?.[1]);
  const unparsedLines = memberLines.filter((_, index) => !codes[index]);
  assert.deepEqual(unparsedLines, [], "Có member enum backend không parse được.");
  return codes;
}

function readBackendRetryableCodes(source) {
  const functionBody = source.match(/export function isDocumentProcessingFailureRetryable\([^)]*\)[^{]*\{([^}]*)\}/u)?.[1];
  assert.ok(functionBody, "Không tìm thấy isDocumentProcessingFailureRetryable ở backend.");
  return [...functionBody.matchAll(/DocumentProcessingFailureCode\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
}

test("web failure codes match the backend DocumentProcessingFailureCode enum", () => {
  const backendCodes = readBackendFailureCodes(readBackendContract());

  assert.ok(backendCodes.length > 0);
  assert.deepEqual([...phase0DocumentProcessingFailureCodes].sort(), [...backendCodes].sort());
});

test("web retryable failure codes match backend isDocumentProcessingFailureRetryable", () => {
  const backendRetryableCodes = new Set(readBackendRetryableCodes(readBackendContract()));

  assert.ok(backendRetryableCodes.size > 0);
  for (const errorCode of phase0DocumentProcessingFailureCodes) {
    assert.equal(isRetryableDocumentFailureCode(errorCode), backendRetryableCodes.has(errorCode), errorCode);
  }
});
