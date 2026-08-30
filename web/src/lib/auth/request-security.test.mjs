import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.WEB_PUBLIC_ORIGIN = "http://localhost:3000";

const { validateBrowserMutation } = await import("./request-security.ts");

test("accepts same-origin mutation", () => {
  const result = validateBrowserMutation(new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
  }));
  assert.equal(result, null);
});

test("falls back to an allowlisted referer", () => {
  const result = validateBrowserMutation(new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { Referer: "http://localhost:3000/home" },
  }));
  assert.equal(result, null);
});

test("rejects missing or cross-site provenance", async () => {
  for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "http://localhost:3000", "Sec-Fetch-Site": "cross-site" }]) {
    const result = validateBrowserMutation(new Request("http://localhost:3000/auth/logout", { method: "POST", headers }));
    assert.equal(result?.status, 403);
    assert.deepEqual(await result?.json(), { code: "CSRF_REJECTED", message: "Yêu cầu không hợp lệ" });
  }
});
