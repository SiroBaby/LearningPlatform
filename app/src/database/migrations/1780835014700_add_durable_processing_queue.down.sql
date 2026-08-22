DROP TABLE IF EXISTS "ai"."processing_job_dlq";
DROP INDEX IF EXISTS "ai"."idx_processing_jobs_expired_lease";
DROP INDEX IF EXISTS "ai"."idx_processing_jobs_claimable";
ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "chk_processing_jobs_technical_retry_count",
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "failure_code",
  DROP COLUMN IF EXISTS "technical_retry_count",
  DROP COLUMN IF EXISTS "next_visible_at",
  DROP COLUMN IF EXISTS "lease_until",
  DROP COLUMN IF EXISTS "lease_id";
