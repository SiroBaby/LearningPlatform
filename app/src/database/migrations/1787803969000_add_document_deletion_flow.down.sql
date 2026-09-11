DROP INDEX IF EXISTS "course"."uq_course_outbox_document_purge";
DROP INDEX IF EXISTS "course"."idx_document_purge_manifest_claimable";
DROP INDEX IF EXISTS "course"."uq_document_purge_manifest_idempotency_key";
DROP INDEX IF EXISTS "course"."uq_document_purge_manifest_document";
DROP TABLE IF EXISTS "course"."document_purge_manifests";
ALTER TABLE "course"."documents"
  DROP CONSTRAINT IF EXISTS "chk_documents_status";
