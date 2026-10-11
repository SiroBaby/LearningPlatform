-- DEAD_LETTER rows record a purge that needs owner action (for example an
-- active reference or denied access). The previous schema cannot represent
-- them, and turning them back into FAILED would let a future purge worker
-- retry a deletion that was deliberately stopped. Refuse the rollback until an
-- operator has resolved every DEAD_LETTER row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "course"."document_purge_manifests"
    WHERE "status" = 'DEAD_LETTER'
  ) THEN
    RAISE EXCEPTION 'document purge manifests in DEAD_LETTER must be resolved before rollback';
  END IF;
END
$$;

-- Dropping the lease would strand RUNNING rows; return them to the queue.
UPDATE "course"."document_purge_manifests"
SET "status" = 'PENDING',
    "updated_at" = now()
WHERE "status" = 'RUNNING';

DROP INDEX IF EXISTS "course"."idx_document_purge_manifest_reclaimable";

ALTER TABLE "course"."document_purge_manifests"
  DROP CONSTRAINT IF EXISTS "chk_document_purge_manifest_status";
ALTER TABLE "course"."document_purge_manifests"
  ADD CONSTRAINT "chk_document_purge_manifest_status"
  CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'));

ALTER TABLE "course"."document_purge_manifests"
  DROP COLUMN IF EXISTS "dead_lettered_at",
  DROP COLUMN IF EXISTS "lease_until",
  DROP COLUMN IF EXISTS "lease_id";
