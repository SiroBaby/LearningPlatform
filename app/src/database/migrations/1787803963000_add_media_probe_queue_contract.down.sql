ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "fk_processing_jobs_probe_result";
DROP INDEX IF EXISTS "ai"."uq_media_probe_result_generation";
DROP INDEX IF EXISTS "ai"."uq_media_probe_result_job_id";
DROP TABLE IF EXISTS "ai"."media_probe_results";
DROP INDEX IF EXISTS "ai"."idx_media_probe_jobs_expired_lease";
DROP INDEX IF EXISTS "ai"."idx_media_probe_jobs_claimable";
DROP INDEX IF EXISTS "ai"."uq_media_probe_job_generation";
DROP INDEX IF EXISTS "ai"."uq_media_probe_job_idempotency_key";
DROP TABLE IF EXISTS "ai"."media_probe_jobs";

ALTER TABLE "ai"."processing_jobs"
  DROP COLUMN IF EXISTS "probe_result_id",
  DROP COLUMN IF EXISTS "deletion_fence",
  DROP COLUMN IF EXISTS "policy_version",
  DROP COLUMN IF EXISTS "probe_generation";
DROP INDEX IF EXISTS "ai"."uq_processing_jobs_full_pipeline_document";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_document_type"
  ON "ai"."processing_jobs" ("document_id", "job_type");
