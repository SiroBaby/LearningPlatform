import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "redirect.ts"), "utf8");

test("redirects unauthenticated guests from admin to login", () => {
  assert.match(source, /if \(kind === "unauthenticated"\) return routes\.login/u);
});

test("redirects authenticated users without the admin role to access denied", () => {
  assert.match(source, /if \(kind === "forbidden"\) return routes\.accessDenied/u);
});

test("renders an unavailable state and the approved snapshot without redirecting", () => {
  assert.match(source, /return null;/u);
});

test("keeps the admin guard server-side and protects the route before rendering", () => {
  const adminPage = readFileSync(resolve(dirname(import.meta.filename), "../../app/admin/page.tsx"), "utf8");
  const adminLayout = readFileSync(resolve(dirname(import.meta.filename), "../../app/admin/layout.tsx"), "utf8");
  const activityPage = readFileSync(resolve(dirname(import.meta.filename), "../../app/admin/activity/page.tsx"), "utf8");
  const healthPage = readFileSync(resolve(dirname(import.meta.filename), "../../app/admin/health/page.tsx"), "utf8");
  const proxy = readFileSync(resolve(dirname(import.meta.filename), "../../proxy.ts"), "utf8");
  assert.match(adminPage, /import \{ redirect \} from "next\/navigation"/u);
  assert.match(adminPage, /getAdminOperations\(\)/u);
  assert.match(adminPage, /if \(redirectPath\) redirect\(redirectPath\)/u);
  assert.match(adminLayout, /getAdminAccess\(\)/u);
  assert.match(adminLayout, /getAdminAccessRedirectPath/u);
  assert.match(adminLayout, /if \(redirectPath\) redirect\(redirectPath\)/u);
  assert.match(adminLayout, /return children;/u);
  assert.match(activityPage, /AdminShell/u);
  assert.match(healthPage, /AdminShell/u);
  assert.match(proxy, /"\/admin\/:path\*"/u);
  assert.match(proxy, /getWebPublicUrl\("\/login"\)/u);
});

test("keeps navigation aligned with the single remaining admin route", () => {
  const routes = readFileSync(resolve(dirname(import.meta.filename), "../routes.ts"), "utf8");
  const nav = readFileSync(resolve(dirname(import.meta.filename), "../nav.ts"), "utf8");
  assert.match(routes, /adminOverview: "\/admin"/u);
  assert.doesNotMatch(routes, /admin(?:Cost|Jobs|Moderation|Support)/u);
  assert.doesNotMatch(nav, /\/admin\/(?:cost|jobs|moderation|support)/u);
});
