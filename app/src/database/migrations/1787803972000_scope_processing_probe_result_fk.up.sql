-- A FULL_PIPELINE job may only point at a probe result owned by the same
-- Document and Owner. The composite key makes that boundary a database rule.

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_result_document_owner"
  ON "ai"."media_probe_results" ("id", "document_id", "owner_id");

ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "fk_processing_jobs_probe_result";

ALTER TABLE "ai"."processing_jobs"
  ADD CONSTRAINT "fk_processing_jobs_probe_result"
  FOREIGN KEY ("probe_result_id", "document_id", "owner_id")
  REFERENCES "ai"."media_probe_results" ("id", "document_id", "owner_id")
  ON DELETE CASCADE;
