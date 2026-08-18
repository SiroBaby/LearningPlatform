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
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.
