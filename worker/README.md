# AI Worker

This worker claims `ai.processing_jobs` from PostgreSQL, reads the minimal
read-only `course.documents` descriptor, extracts PDF/text, writes fenced
`ai.chunks`, calls the configured LLM, and writes the final job state with an
`ai.outbox` result in one transaction. Node remains the only runtime that
projects that result into `course`.

The deployment role must have exactly the permissions in
`1780835014800_grant_ai_worker_source_read.up.sql`: descriptor-only reads from
`course.documents`, no `course.outbox` access, and writes only to `ai`.

`/healthz` reports that the health server is alive. `/readyz` becomes ready
only after the database connection and consumer lifecycle start.

Required configuration: `AI_WORKER_DATABASE_URL` (the restricted `ai_worker`
login URL), `AI_WORKER_MIGRATION_DATABASE_URL` (the tracked-migration role),
`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`,
`OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET`, and
`AI_WORKER_HEALTH_ADDRESS`. `AI_LLM_PROVIDER` defaults to `fake` for local
development. Production sets it to `openai-compatible` with `OPENAI_API_KEY`,
`OPENAI_BASE_URL`, and `OPENAI_MODEL`.
