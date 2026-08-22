ALTER TABLE "ai"."processing_jobs"
  DROP COLUMN IF EXISTS "budget_status",
  DROP COLUMN IF EXISTS "settled_credits",
  DROP COLUMN IF EXISTS "estimated_credits";
