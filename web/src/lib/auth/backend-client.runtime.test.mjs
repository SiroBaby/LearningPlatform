import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpsRequest } from "node:https";
import { once } from "node:events";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const WEB_ROOT = join(new URL("../../../../", import.meta.url).pathname, "web");
const TEST_TIMEOUT_MS = 60_000;

test("BFF uses mTLS, forwards sessions, and sets host-only cookies", { timeout: TEST_TIMEOUT_MS }, async () => {
  const pkiDirectory = await mkdtemp(join(tmpdir(), "learning-platform-bff-mtls-"));
  const pki = await createPki(pkiDirectory);
  const backendRequests = [];
  const backend = createBackendServer(pki, backendRequests);
  const backendPort = await listen(backend);
  const webPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const next = spawn("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    cwd: WEB_ROOT,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      AUTH_INTERNAL_API_BASE_URL: `https://127.0.0.1:${backendPort}`,
      AUTH_INTERNAL_MTLS_CA_PATH: pki.ca,
      AUTH_INTERNAL_MTLS_CERT_PATH: pki.clientCert,
      AUTH_INTERNAL_MTLS_KEY_PATH: pki.clientKey,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(webPort),
      WEB_LOCAL_PUBLIC_ORIGIN: webOrigin,
      WEB_PUBLIC_ORIGIN: webOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForWeb(next, `${webOrigin}/auth/me`);

    const missingSession = await fetch(`${webOrigin}/auth/me`);
    assert.equal(missingSession.status, 401);
    assert.equal(backendRequests.length, 0);

    const state = "runtime-state";
    const binding = createHash("sha256").update(state, "utf8").digest("base64url");
    const callback = await fetch(`${webOrigin}/auth/google/callback?code=runtime-code&state=${state}`, {
      headers: { cookie: `lp_oauth_browser_binding=${binding}` },
      redirect: "manual",
    });
    assert.equal(callback.status, 307);
    assert.equal(callback.headers.get("location"), `${webOrigin}/home`);
    const callbackCookies = setCookieHeader(callback);
    assertCookieContract(callbackCookies, "lp_access", "access-callback", { secure: true });
    assertCookieContract(callbackCookies, "lp_refresh", "refresh-callback", { secure: true });
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/google/exchange").method, "POST");
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/me").authorization, "Bearer access-callback");
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/me").clientSubjectAltName, `URI:${pki.clientSpiffeUri}`);

    const me = await fetch(`${webOrigin}/auth/me`, { headers: { cookie: "lp_access=access-callback" } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { onboardingCompletedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/me").authorization, "Bearer access-callback");

    const invalidMe = await fetch(`${webOrigin}/auth/me`, { headers: { cookie: "lp_access=invalid-access" } });
    assert.equal(invalidMe.status, 401);
    assert.deepEqual(await invalidMe.json(), {
      code: "SESSION_INVALID",
      message: "Phiên đăng nhập không còn hiệu lực",
    });
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/me").authorization, "Bearer invalid-access");

    const refresh = await fetch(`${webOrigin}/auth/refresh`, {
      headers: {
        cookie: "lp_refresh=refresh-callback",
        origin: webOrigin,
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });
    assert.equal(refresh.status, 200);
    const refreshCookies = setCookieHeader(refresh);
    assertCookieContract(refreshCookies, "lp_access", "access-refresh", { secure: true });
    assertCookieContract(refreshCookies, "lp_refresh", "refresh-refresh", { secure: true });
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/refresh").authorization, "Bearer refresh-callback");

    const logout = await fetch(`${webOrigin}/auth/logout`, {
      headers: {
        cookie: "lp_access=access-refresh",
        origin: webOrigin,
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    });
    assert.equal(logout.status, 200);
    assert.equal(lastRequest(backendRequests, "/internal/v1/auth/logout").authorization, "Bearer access-refresh");
    assert.match(setCookieHeader(logout), /lp_access=/u);

    const scopeDenied = await requestBackend(backendPort, pki, "/internal/v1/auth/admin", "Bearer access-refresh");
    assert.equal(scopeDenied.status, 403);
    const wrongService = await requestBackend(
      backendPort,
      pki,
      "/internal/v1/auth/me",
      "Bearer access-refresh",
      { cert: pki.wrongClientCert, key: pki.wrongClientKey },
    );
    assert.equal(wrongService.status, 403);
  } finally {
    await stopNext(next);
    await closeServer(backend);
    await rm(pkiDirectory, { force: true, recursive: true });
  }
});

function createBackendServer(pki, requests) {
  return createServer({
    ca: readFileSync(pki.ca),
    cert: readFileSync(pki.serverCert),
    key: readFileSync(pki.serverKey),
    rejectUnauthorized: true,
    requestCert: true,
  }, (request, response) => {
    const record = {
      authorization: request.headers.authorization,
      clientSubjectAltName: request.socket.getPeerCertificate().subjectaltname,
      method: request.method,
      path: request.url,
    };
    requests.push(record);
    const allowedRoutes = new Set([
      "/internal/v1/auth/google/exchange",
      "/internal/v1/auth/google/start",
      "/internal/v1/auth/logout",
      "/internal/v1/auth/me",
      "/internal/v1/auth/refresh",
    ]);
    const expectedServiceIdentity = `URI:${pki.clientSpiffeUri}`;
    if (!request.socket.authorized || !record.clientSubjectAltName?.split(",").map((value) => value.trim()).includes(expectedServiceIdentity)) {
      return sendJson(response, 403, { code: "SERVICE_IDENTITY_DENIED" });
    }
    if (!allowedRoutes.has(request.url ?? "")) return sendJson(response, 403, { code: "ROUTE_SCOPE_DENIED" });
    if (request.url === "/internal/v1/auth/me" && request.headers.authorization !== "Bearer access-callback" && request.headers.authorization !== "Bearer access-refresh") {
      return sendJson(response, 401, { code: "UNAUTHORIZED" });
    }
    if (request.url === "/internal/v1/auth/refresh" && request.headers.authorization !== "Bearer refresh-callback") {
      return sendJson(response, 401, { code: "UNAUTHORIZED" });
    }
    if (request.url === "/internal/v1/auth/logout" && request.headers.authorization !== "Bearer access-refresh") {
      return sendJson(response, 401, { code: "UNAUTHORIZED" });
    }
    if (request.url === "/internal/v1/auth/google/exchange") {
      return sendJson(response, 200, {
        accessExpiresAt: "2026-01-01T00:15:00.000Z",
        accessToken: "access-callback",
        refreshExpiresAt: "2026-01-31T00:00:00.000Z",
        refreshToken: "refresh-callback",
      });
    }
    if (request.url === "/internal/v1/auth/me") return sendJson(response, 200, { onboardingCompletedAt: "2026-01-01T00:00:00.000Z" });
    if (request.url === "/internal/v1/auth/refresh") {
      return sendJson(response, 200, {
        accessExpiresAt: "2026-01-01T00:30:00.000Z",
        accessToken: "access-refresh",
        refreshExpiresAt: "2026-02-01T00:00:00.000Z",
        refreshToken: "refresh-refresh",
      });
    }
    if (request.url === "/internal/v1/auth/logout") return sendJson(response, 200, { ok: true });
    return sendJson(response, 404, { code: "NOT_FOUND" });
  });
}

function createPki(directory) {
  const ca = join(directory, "ca.crt");
  const caKey = join(directory, "ca.key");
  const serverCert = join(directory, "server.crt");
  const serverCsr = join(directory, "server.csr");
  const serverExt = join(directory, "server.ext");
  const serverKey = join(directory, "server.key");
  const clientCert = join(directory, "client.crt");
  const clientCsr = join(directory, "client.csr");
  const clientExt = join(directory, "client.ext");
  const clientKey = join(directory, "client.key");
  const wrongClientCert = join(directory, "wrong-client.crt");
  const wrongClientCsr = join(directory, "wrong-client.csr");
  const wrongClientExt = join(directory, "wrong-client.ext");
  const wrongClientKey = join(directory, "wrong-client.key");
  const serial = join(directory, "ca.srl");
  const clientSpiffeUri = "spiffe://learning-platform.local/ns/test/sa/web-bff";

  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", ca, "-days", "1", "-subj", "/CN=test-ca"]);
  writeFileSync(serverExt, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", serverKey, "-out", serverCsr, "-subj", "/CN=127.0.0.1"]);
  openssl(["x509", "-req", "-in", serverCsr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-CAserial", serial, "-out", serverCert, "-days", "1", "-extfile", serverExt]);
  writeFileSync(clientExt, "subjectAltName=URI:spiffe://learning-platform.local/ns/test/sa/web-bff\nextendedKeyUsage=clientAuth\n");
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", clientKey, "-out", clientCsr, "-subj", "/CN=web-bff"]);
  openssl(["x509", "-req", "-in", clientCsr, "-CA", ca, "-CAkey", caKey, "-CAserial", serial, "-out", clientCert, "-days", "1", "-extfile", clientExt]);
  writeFileSync(wrongClientExt, "subjectAltName=URI:spiffe://learning-platform.local/ns/test/sa/other-service\nextendedKeyUsage=clientAuth\n");
  openssl(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", wrongClientKey, "-out", wrongClientCsr, "-subj", "/CN=other-service"]);
  openssl(["x509", "-req", "-in", wrongClientCsr, "-CA", ca, "-CAkey", caKey, "-CAserial", serial, "-out", wrongClientCert, "-days", "1", "-extfile", wrongClientExt]);
  return { ca, clientCert, clientKey, clientSpiffeUri, serverCert, serverKey, wrongClientCert, wrongClientKey };
}

function openssl(args) {
  execFileSync("openssl", args, { stdio: "ignore" });
}

async function freePort() {
  const server = createTcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function waitForWeb(next, url) {
  const deadline = Date.now() + TEST_TIMEOUT_MS - 5_000;
  let lastError;
  while (Date.now() < deadline) {
    if (next.exitCode !== null) throw new Error("Next exited before readiness");
    try {
      const response = await fetch(url);
      if (response.status === 401) return;
      lastError = new Error(`Unexpected readiness status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("Timed out waiting for Next dev");
}

async function stopNext(next) {
  if (next.exitCode !== null) return;
  signalNextProcessTree(next, "SIGTERM");
  await Promise.race([
    once(next, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (next.exitCode === null) signalNextProcessTree(next, "SIGKILL");
}

function signalNextProcessTree(next, signal) {
  if (process.platform === "win32" || next.pid === undefined) {
    next.kill(signal);
    return;
  }
  try {
    process.kill(-next.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function assertCookieContract(header, name, value, { secure }) {
  const cookie = header.split("\n").find((candidate) => candidate.startsWith(`${name}=${value};`));
  assert.ok(cookie, `Expected ${name} cookie`);
  if (secure) assert.match(cookie, /;\s*Secure(?:;|$)/iu);
  else assert.doesNotMatch(cookie, /;\s*Secure(?:;|$)/iu);
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/iu);
  assert.match(cookie, /;\s*SameSite=Lax(?:;|$)/iu);
  assert.match(cookie, /;\s*Path=\/(?:;|$)/iu);
  assert.doesNotMatch(cookie, /;\s*Domain=/iu);
}

function requestBackend(port, pki, path, authorization, client = { cert: pki.clientCert, key: pki.clientKey }) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest({
      ca: readFileSync(pki.ca),
      cert: readFileSync(client.cert),
      key: readFileSync(client.key),
      method: "GET",
      path,
      port,
      rejectUnauthorized: true,
      hostname: "127.0.0.1",
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode ?? 502 }));
    });
    request.once("error", reject);
    if (authorization) request.setHeader("authorization", authorization);
    request.end();
  });
}

function setCookieHeader(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join("\n")
    : response.headers.get("set-cookie") ?? "";
}

function lastRequest(requests, path) {
  const request = [...requests].reverse().find((candidate) => candidate.path === path);
  assert.ok(request, `Expected request for ${path}`);
  return request;
}
