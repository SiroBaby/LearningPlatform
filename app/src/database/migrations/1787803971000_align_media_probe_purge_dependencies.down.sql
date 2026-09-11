ALTER TABLE IF EXISTS "course"."document_probe_receipts"
  DROP CONSTRAINT IF EXISTS "fk_document_probe_receipts_document";

ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "fk_processing_jobs_probe_result";
ALTER TABLE "ai"."processing_jobs"
  ADD CONSTRAINT "fk_processing_jobs_probe_result"
  FOREIGN KEY ("probe_result_id")
  REFERENCES "ai"."media_probe_results" ("id")
  ON DELETE RESTRICT;

ALTER TABLE "ai"."media_probe_results"
  DROP CONSTRAINT IF EXISTS "fk_media_probe_results_job";
ALTER TABLE "ai"."media_probe_results"
  ADD CONSTRAINT "fk_media_probe_results_job"
  FOREIGN KEY ("media_probe_job_id")
  REFERENCES "ai"."media_probe_jobs" ("id")
  ON DELETE RESTRICT;
