-- Rolling back removes TEXT_EXTRACT rows; their Documents stay PROCESSING until the Owner retries or stuck
-- handling fails them. Reserved credits are unaffected (TEXT_EXTRACT never reserves).
DELETE FROM "ai"."processing_jobs" WHERE "job_type" = 'TEXT_EXTRACT';

DROP INDEX IF EXISTS "ai"."uq_processing_jobs_text_extract_document";

ALTER TABLE "ai"."processing_jobs"
  DROP COLUMN IF EXISTS "processing_attempt",
  DROP COLUMN IF EXISTS "full_pipeline_job_id";
