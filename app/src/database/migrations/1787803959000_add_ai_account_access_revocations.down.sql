ALTER TABLE "ai"."processing_jobs"
  DROP CONSTRAINT IF EXISTS "chk_ai_processing_jobs_status";
DROP INDEX IF EXISTS "idx_ai_processing_jobs_cancellation";
ALTER TABLE "ai"."processing_jobs"
  DROP COLUMN IF EXISTS "cancelled_at",
  DROP COLUMN IF EXISTS "cancellation_reason",
  DROP COLUMN IF EXISTS "cancellation_marker_id";
DROP TABLE IF EXISTS "ai"."account_access_revocations";
