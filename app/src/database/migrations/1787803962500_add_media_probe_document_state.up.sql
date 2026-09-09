-- Durable document state required before media probe jobs are accepted.
-- This migration owns only the content-side state; AI queue tables are added
-- by the media probe processing work.
ALTER TABLE "course"."documents"
  ADD COLUMN IF NOT EXISTS "probe_generation" uuid,
  ADD COLUMN IF NOT EXISTS "probe_policy_version" varchar(80),
  ADD COLUMN IF NOT EXISTS "deletion_fence" bigint NOT NULL DEFAULT 0;
