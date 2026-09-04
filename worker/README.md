# AI Worker

This worker claims `ai.processing_jobs` from PostgreSQL, reads the minimal
read-only `course.documents` descriptor, extracts PDF/text, writes fenced
`ai.chunks`, calls the configured LLM, and writes the final job state with an
`ai.outbox` result in one transaction. Node remains the only runtime that
projects that result into `course`.

## Local document E2E harness

`scripts/local-document-e2e.sh` is an opt-in, destructive-to-its-own-fixtures
local smoke harness. It builds the API and Go worker, then creates uniquely
named PostgreSQL 16 and MinIO containers/volumes, starts the API, Node relay,
and Go worker, and completes one TEXT Document upload-to-Quiz flow with Go's
deterministic `fake` provider by default. This validates the queue, relay,
object storage, and Go processing pipeline without a live provider. It always
removes only the exact containers, volumes, temporary files, and child PIDs it
created; it never uses Docker prune.

Run it only on a local Docker host:

```sh
worker/scripts/local-document-e2e.sh
```

The Go worker child sources `worker/.env` without displaying its contents, then
the script overwrites database and object-storage settings for the isolated
local fixtures. The default E2E provider mode is `fake`. Set
`LOCAL_DOCUMENT_E2E_PROVIDER_MODE=real` to opt in to the provider from `.env`;
the Go worker validates that it is `openai-compatible`, and invalid modes are
rejected before Docker resources are created. Its terminal output contains
phase/status markers only; runtime logs and request payloads remain in a
temporary directory that is removed during cleanup.

`OBJECT_STORAGE_ENDPOINT` uses the same host-only contract as the API; keep the
scheme, TCP port, path, query, and fragment out of that value and configure the
port separately with `OBJECT_STORAGE_PORT`.

`/healthz` reports that the health server is alive. `/readyz` becomes ready
only after the database connection and consumer lifecycle start.

Use [`.env.example`](.env.example) as the canonical template for every worker
command. Copy it to the ignored local file and fill in the `CHANGE_ME` values:

```sh
cp worker/.env.example worker/.env
${EDITOR:-vi} worker/.env
set -a
. worker/.env
set +a
```

The durable consumer uses a bounded pool configured by `AI_WORKER_CONCURRENCY`.
Each claimed job receives its own `AI_WORKER_JOB_TIMEOUT_MS`; cancellation leaves
the PostgreSQL lease fenced for safe replay after expiry. Polling and shutdown
drain are bounded by `AI_WORKER_POLL_INTERVAL_MS` and
`AI_WORKER_SHUTDOWN_TIMEOUT_MS` respectively.

The provider contract accepts `fake` or `openai-compatible`. For a real
provider, set `OPENAI_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`, then use
one coherent pair: `chat-completions-json-v1` with `chat-completions`, or
`responses-json-v1` with `responses`. `OPENAI_STRUCTURED_OUTPUT_MODE` must be
`json-object` or `json-schema-strict`; `OPENAI_REQUEST_TIMEOUT_MS` must be
between 1 and 120000.

Production reuses `learning-platform-api-runtime` for the shared database and
does not require separate SSM parameters, a Secret, or a PostgreSQL role.

An external or local invocation that supplies only the legacy API key, base
URL, and model variables is intentionally rejected. It must also declare the
capability, transport, structured-output mode, and timeout above; the worker
does not infer unsafe defaults for a real provider.

The E2E default does not validate the real provider alias. Validate that alias
separately with exactly one bounded local provider check after sourcing the
environment:

```sh
(cd worker && go run ./cmd/ai-worker preflight)
```

Do not use the real provider as the E2E default; if a real-provider E2E is
needed, invoke it explicitly with
`LOCAL_DOCUMENT_E2E_PROVIDER_MODE=real`.

It sends one bounded non-document request using the configured alias, transport,
and structured-output mode. A pass means the provider accepts that contract
and returns exactly one valid probe output; a failure exits non-zero. This
command does not connect to PostgreSQL or object storage and does not mutate
documents, jobs, chunks, or database state. Neither it nor normal startup logs
the provider URL, prompt, response, or credentials.

For a normal worker start, `/healthz` is available before the provider gate;
`/readyz` remains unavailable until the gate and consumer bootstrap complete.
