ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "fk_processing_jobs_probe_result";

ALTER TABLE "ai"."processing_jobs"
  ADD CONSTRAINT "fk_processing_jobs_probe_result"
  FOREIGN KEY ("probe_result_id")
  REFERENCES "ai"."media_probe_results" ("id")
  ON DELETE CASCADE;

DROP INDEX IF EXISTS "ai"."uq_media_probe_result_document_owner";
