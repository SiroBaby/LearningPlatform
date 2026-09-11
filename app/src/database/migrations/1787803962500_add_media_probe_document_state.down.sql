ALTER TABLE "course"."documents"
  DROP COLUMN IF EXISTS "deletion_fence",
  DROP COLUMN IF EXISTS "probe_policy_version",
  DROP COLUMN IF EXISTS "probe_generation";
