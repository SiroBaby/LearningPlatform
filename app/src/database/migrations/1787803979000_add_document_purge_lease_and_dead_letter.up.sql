-- Purge worker lease fence and terminal dead-letter state (#159).
-- Expand-only: no existing runtime reads or writes these columns, and the
-- widened status check still accepts every value written by older runtimes.
-- No trigger or SQL function: lease predicates stay in repository SQL.

ALTER TABLE "course"."document_purge_manifests"
  ADD COLUMN IF NOT EXISTS "lease_id" uuid,
  ADD COLUMN IF NOT EXISTS "lease_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamptz;

ALTER TABLE "course"."document_purge_manifests"
  DROP CONSTRAINT IF EXISTS "chk_document_purge_manifest_status";
ALTER TABLE "course"."document_purge_manifests"
  ADD CONSTRAINT "chk_document_purge_manifest_status"
  CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER'));

-- A worker that crashed mid-purge leaves RUNNING with an expired lease.
CREATE INDEX IF NOT EXISTS "idx_document_purge_manifest_reclaimable"
  ON "course"."document_purge_manifests" ("lease_until")
  WHERE "status" = 'RUNNING';
