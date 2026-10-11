# Worker Rules

## Scope And Source Of Truth

- These rules apply to the worker runtime in `worker/`.
- Provider failures must be classified into stable domain codes before retry, finalization, persistence, or logging. Do not expose raw SDK/provider errors.
- Provider startup preflight must make one bounded synthetic, non-document request through the same transport, schema, and decoder as quiz generation; validate the full provider-owned Quiz structure and never log its payload.
- Before a PR, provider/model/preflight changes must pass the worker build and affected tests plus exactly one local real-alias full-quiz `ai-worker preflight` using runtime environment; dev only validates deployment-specific wiring/E2E.
- Before a PR, worker lifecycle, concurrency, timeout, or shutdown changes must pass `go test -race ./...` and one local executable smoke (for example `ai-worker preflight` with the fake provider or the configured real alias); if PostgreSQL/object storage are unavailable, record that full startup/E2E evidence is not covered.
- Any JSON value crossing from Go to the Node return seam must preserve fields required by the versioned handoff contract even when their valid value is zero; cover that serialization contract with a regression test before emitting `ai.outbox`.

- Build every PostgreSQL connection from `config.Database.PoolConfig()`/`ConnConfig()`; never pass a raw URL to `pgxpool.New`/`pgx.Connect`. pgx defaults to `sslmode=prefer` (unverified TLS with plaintext fallback), and the verified TLS policy is applied only by those builders. Both verify modes must check the host name like the API's node-postgres `verify-ca`; never weaken one runtime for the same `DB_SSL_MODE`. pgx CancelRequest stays plaintext (PID + cancel key only). When `DB_HOST` names a TCP forwarder (media probe → `media-probe-db-egress`), keep verification on the real server via `DB_SSL_SERVER_NAME`; never use `InsecureSkipVerify` or a custom `VerifyPeerCertificate` to make a forwarder name pass.
- Every S3 client behind an egress allowlist (Squid `media-egress-proxy`) must pin the configured host: call `SetS3EnableDualstack(false)` after `minio.New` and never enable transfer acceleration. minio-go v7 rewrites Amazon endpoints to `s3.dualstack.*` by default, which Squid rejects with 403 (#210). Test through a fake proxy that records the host each request is really sent to; checking only the configured endpoint string does not catch the rewrite.

## Processing Failure Logging

- Every processing retry or final failure must emit one safe structured event when the outcome is known: retry scheduled, retry persistence failed, final failure persisted, final-failure persistence failed, or persistence outcome ambiguous.
- Use stable event names and include only bounded operational metadata needed for correlation and diagnosis, such as phase, attempt, job identifier, correlation identifier when available, failure code, and outcome. Keep event fields consistent across error paths.
- Never log request or source content, prompt, generated questions or answers, credentials, provider responses, raw error messages, stack traces, storage references, or other payload data. Safe codes and fixed messages are the contract.
- A persistence or commit error whose final state is uncertain is an explicit `persistence_ambiguous` event. Do not silently retry or represent that state as a confirmed final failure.
- A malformed store outcome is an explicit `worker.processing.retry.contract_violation` event with bounded phase/category metadata; fail closed without treating it as persistence success.
- Normal polling and no-work cycles remain silent; logging is for startup/shutdown, real work, retry/backoff, and failure outcomes.
- Emit `worker.processing.completed` only from an explicit completed outcome; a successful retry schedule or DLQ finalization is a non-completion outcome so durable replays cannot be logged as completions.

## Tests

- The local document E2E harness must export a sanitized Google OAuth fixture before starting the API; `GoogleOAuthClientProvider` is eager, so the harness must not depend on a developer's `app/.env`.
- When using `psql` variables in a fixture, pipe the SQL through stdin; `psql --command` does not interpolate `--set` variables in this runtime. Keep fixture output redirected and never expose generated tokens or credentials.
- Tests for processing failures must assert the structured event name, normalized level, and safe metadata for scheduled retry, retry persistence failure, final failure, final-failure persistence failure, and ambiguous persistence outcomes.
- Add assertions that forbidden payloads and raw provider/error text do not appear in emitted events. Keep these tests at the logger/consumer boundary so future error paths cannot bypass the contract.
- When a harness runs a host binary instead of the release image (for example native `ffprobe` in the local document E2E), derive the expected version from that binary; never copy the image artifact pin, which only matches the image and makes the worker exit at its version check. Keep the production pin in `worker/Dockerfile` and the Kubernetes manifest.
- Every CI job that runs the worker Go tests (`worker-ci.yml` quality and `deploy-dev.yml` worker-quality) must install the same test toolchain, including `ffmpeg`/`ffprobe`, before `go test ./...`; a dependency added to one job must be added to the other, and the deploy workflow policy test asserts this.
- CI installs `ffmpeg`/`ffprobe` only through `worker/scripts/install-media-tools.sh`, which downloads the BtbN artifact pinned by the `FFPROBE_*` ARG literals in `worker/Dockerfile` and verifies its SHA-256 and reported version. Never `apt-get install ffmpeg` in a workflow: the Ubuntu mirror pulled 99 packages in ~600 s (run 38032634393) and the version is unpinned; `deploy/dev/tests/test-media-tools-ci.sh` rejects it.
