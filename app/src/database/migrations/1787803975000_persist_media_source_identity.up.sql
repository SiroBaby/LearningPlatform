-- Keep the canonical pipeline identity and the confirmed media object identity
-- on the course-side Document so retries and deletion do not query ai.* or S3.
ALTER TABLE "course"."documents"
  ADD COLUMN IF NOT EXISTS "full_pipeline_job_id" uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "processing_attempt" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "media_source_bucket" varchar(255),
  ADD COLUMN IF NOT EXISTS "media_source_version_id" varchar(255),
  ADD COLUMN IF NOT EXISTS "media_source_etag" varchar(255),
  ADD COLUMN IF NOT EXISTS "media_source_content_length" bigint;

UPDATE "course"."documents"
SET "full_pipeline_job_id" = gen_random_uuid()
WHERE "full_pipeline_job_id" IS NULL;

ALTER TABLE "course"."documents"
  ALTER COLUMN "full_pipeline_job_id" SET NOT NULL,
  ADD CONSTRAINT "chk_documents_processing_attempt"
    CHECK ("processing_attempt" >= 0),
  ADD CONSTRAINT "chk_documents_media_source_locator"
    CHECK (
      ("media_source_bucket" IS NULL
        AND "media_source_version_id" IS NULL
        AND "media_source_etag" IS NULL
        AND "media_source_content_length" IS NULL)
      OR (
        length(btrim("media_source_bucket")) > 0
        AND length(btrim("media_source_version_id")) > 0
        AND length(btrim("media_source_etag")) > 0
        AND "media_source_content_length" >= 0
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "uq_documents_full_pipeline_job_id"
  ON "course"."documents" ("full_pipeline_job_id");
