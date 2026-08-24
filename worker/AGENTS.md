# Worker Rules

## Scope And Source Of Truth

- These rules apply to the worker runtime in `worker/`.
- Provider failures must be classified into stable domain codes before retry, finalization, persistence, or logging. Do not expose raw SDK/provider errors.
- Provider startup preflight must make one bounded synthetic, non-document request through the same transport, schema, and decoder as quiz generation; validate the full provider-owned Quiz structure and never log its payload.
- Before a PR, provider/model/preflight changes must pass the worker build and affected tests plus exactly one local real-alias full-quiz `ai-worker preflight` using runtime environment; dev only validates deployment-specific wiring/E2E.
- Before a PR, worker lifecycle, concurrency, timeout, or shutdown changes must pass `go test -race ./...` and one local executable smoke (for example `ai-worker preflight` with the fake provider or the configured real alias); if PostgreSQL/object storage are unavailable, record that full startup/E2E evidence is not covered.
- Any JSON value crossing from Go to the Node return seam must preserve fields required by the versioned handoff contract even when their valid value is zero; cover that serialization contract with a regression test before emitting `ai.outbox`.

## Processing Failure Logging

- Every processing retry or final failure must emit one safe structured event when the outcome is known: retry scheduled, retry persistence failed, final failure persisted, final-failure persistence failed, or persistence outcome ambiguous.
- Use stable event names and include only bounded operational metadata needed for correlation and diagnosis, such as phase, attempt, job identifier, correlation identifier when available, failure code, and outcome. Keep event fields consistent across error paths.
- Never log request or source content, prompt, generated questions or answers, credentials, provider responses, raw error messages, stack traces, storage references, or other payload data. Safe codes and fixed messages are the contract.
- A persistence or commit error whose final state is uncertain is an explicit `persistence_ambiguous` event. Do not silently retry or represent that state as a confirmed final failure.
- Normal polling and no-work cycles remain silent; logging is for startup/shutdown, real work, retry/backoff, and failure outcomes.

## Tests

- Tests for processing failures must assert the structured event name, normalized level, and safe metadata for scheduled retry, retry persistence failure, final failure, final-failure persistence failure, and ambiguous persistence outcomes.
- Add assertions that forbidden payloads and raw provider/error text do not appear in emitted events. Keep these tests at the logger/consumer boundary so future error paths cannot bypass the contract.
