# AI Worker

This worker claims `ai.processing_jobs` from PostgreSQL, reads the minimal
read-only `course.documents` descriptor, extracts PDF/text, writes fenced
`ai.chunks`, calls the configured LLM, and writes the final job state with an
`ai.outbox` result in one transaction. Node remains the only runtime that
projects that result into `course`.

`/healthz` reports that the health server is alive. `/readyz` becomes ready
only after the database connection and consumer lifecycle start.

Required configuration: the existing backend database keys `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`,
`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`,
`OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET`, and
`AI_WORKER_HEALTH_ADDRESS`. `AI_LLM_PROVIDER` defaults to `fake` for local
development. Production reuses `learning-platform-api-runtime` for the shared
database and does not require separate SSM parameters, a Secret, or a
PostgreSQL role. It sets `AI_LLM_PROVIDER` to `openai-compatible` with
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`,
`OPENAI_CAPABILITY_VERSION`, `OPENAI_TRANSPORT`, and
`OPENAI_STRUCTURED_OUTPUT_MODE`, and a bounded `OPENAI_REQUEST_TIMEOUT_MS`
(1 through 120000). The capability and transport must be either
`chat-completions-json-v1` / `chat-completions` or `responses-json-v1` /
`responses`; a model alias does not determine either.

An external or local invocation that supplies only the legacy API key, base
URL, and model variables is intentionally rejected. It must also declare the
capability, transport, structured-output mode, and timeout above; the worker
does not infer unsafe defaults for a real provider.

For an explicit configuration or deployment gate, run `ai-worker preflight`.
It sends one bounded non-document request using the configured alias,
transport, and structured-output mode, then exits non-zero unless the response
contains exactly one valid probe output. A normal `ai-worker` startup runs the
same gate before migrations, storage checks, or job consumption. Neither path
logs the provider URL, prompt, response, or credentials.

For a normal worker start, `/healthz` is available before the provider gate;
`/readyz` remains unavailable until the gate and consumer bootstrap complete.
