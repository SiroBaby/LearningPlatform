ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN "estimated_credits" bigint,
  ADD COLUMN "settled_credits" bigint,
  ADD COLUMN "budget_status" varchar(20);
