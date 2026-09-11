DROP INDEX IF EXISTS "course"."uq_documents_full_pipeline_job_id";

ALTER TABLE "course"."documents"
  DROP CONSTRAINT IF EXISTS "chk_documents_media_source_locator",
  DROP CONSTRAINT IF EXISTS "chk_documents_processing_attempt",
  DROP COLUMN IF EXISTS "media_source_content_length",
  DROP COLUMN IF EXISTS "media_source_etag",
  DROP COLUMN IF EXISTS "media_source_version_id",
  DROP COLUMN IF EXISTS "media_source_bucket",
  DROP COLUMN IF EXISTS "processing_attempt",
  DROP COLUMN IF EXISTS "full_pipeline_job_id";
