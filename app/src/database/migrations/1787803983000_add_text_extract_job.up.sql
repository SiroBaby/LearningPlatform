-- ADR-0033: PDF/TXT credits are reserved after a TEXT_EXTRACT job measured the real text.
-- Expand-only and idempotent. TEXT_EXTRACT rows live in ai.processing_jobs next to FULL_PIPELINE;
-- job_type has no CHECK constraint, so only the identity columns and a per-document unique index are added.
-- Older runtimes never read these columns and never claim TEXT_EXTRACT rows.
ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN IF NOT EXISTS "full_pipeline_job_id" uuid,
  ADD COLUMN IF NOT EXISTS "processing_attempt" integer;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_processing_jobs_text_extract_document"
  ON "ai"."processing_jobs" ("document_id")
  WHERE "job_type" = 'TEXT_EXTRACT';
