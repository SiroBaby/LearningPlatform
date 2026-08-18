# Worker Rules

## Scope And Source Of Truth

- These rules apply to the worker runtime in `worker/`.
- Provider failures must be classified into stable domain codes before retry, finalization, persistence, or logging. Do not expose raw SDK/provider errors.

## Processing Failure Logging

- Every processing retry or final failure must emit one safe structured event when the outcome is known: retry scheduled, retry persistence failed, final failure persisted, final-failure persistence failed, or persistence outcome ambiguous.
- Use stable event names and include only bounded operational metadata needed for correlation and diagnosis, such as phase, attempt, job identifier, correlation identifier when available, failure code, and outcome. Keep event fields consistent across error paths.
- Never log request or source content, prompt, generated questions or answers, credentials, provider responses, raw error messages, stack traces, storage references, or other payload data. Safe codes and fixed messages are the contract.
- A persistence or commit error whose final state is uncertain is an explicit `persistence_ambiguous` event. Do not silently retry or represent that state as a confirmed final failure.
- Normal polling and no-work cycles remain silent; logging is for startup/shutdown, real work, retry/backoff, and failure outcomes.

## Tests

- Tests for processing failures must assert the structured event name, normalized level, and safe metadata for scheduled retry, retry persistence failure, final failure, final-failure persistence failure, and ambiguous persistence outcomes.
- Add assertions that forbidden payloads and raw provider/error text do not appear in emitted events. Keep these tests at the logger/consumer boundary so future error paths cannot bypass the contract.
