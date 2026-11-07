-- Derived audio manifest and decoded duration for media STT (#160 PR4, D9 #1/#2).
-- Expand-only and idempotent: a new table and one nullable column. Runtimes that
-- predate this migration neither read nor write them, so rollout order between
-- API, probe, and full-pipeline workers does not matter.
-- No trigger or SQL function: fence predicates stay in repository SQL.

CREATE TABLE IF NOT EXISTS "ai"."media_audio_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "media_probe_job_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "probe_generation" uuid NOT NULL,
  "deletion_fence" bigint NOT NULL CHECK ("deletion_fence" >= 0),
  "chunk_index" integer NOT NULL CHECK ("chunk_index" >= 0),
  "bucket" varchar(255) NOT NULL CHECK (length(btrim("bucket")) > 0),
  "object_key" varchar(500) NOT NULL CHECK ("object_key" LIKE 'derived-audio/%'),
  "version_id" varchar(255) NOT NULL CHECK (length(btrim("version_id")) > 0),
  "etag" varchar(255) NOT NULL CHECK (length(btrim("etag")) > 0),
  "sha256" char(64) NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "content_length" bigint NOT NULL CHECK ("content_length" > 0),
  -- Milliseconds from the start of the decoded audio. The body is the span the
  -- chunk owns; the file also covers the overlap on both sides.
  "body_start_ms" integer NOT NULL CHECK ("body_start_ms" >= 0),
  "body_end_ms" integer NOT NULL,
  "file_start_ms" integer NOT NULL CHECK ("file_start_ms" >= 0),
  "file_end_ms" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_media_audio_chunks_span"
    CHECK ("body_end_ms" > "body_start_ms"
       AND "file_start_ms" <= "body_start_ms"
       AND "file_end_ms" >= "body_end_ms"),
  -- Deleting the probe job (Document deletion cascade, ADR-0031) removes the
  -- manifest; the S3 versions were already captured by the purge manifest.
  CONSTRAINT "fk_media_audio_chunks_job"
    FOREIGN KEY ("media_probe_job_id")
    REFERENCES "ai"."media_probe_jobs" ("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_audio_chunks_job_index"
  ON "ai"."media_audio_chunks" ("media_probe_job_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "idx_media_audio_chunks_document"
  ON "ai"."media_audio_chunks" ("document_id", "owner_id");

-- Decoded duration (D10). NULL means the probe ran without audio preparation.
ALTER TABLE "ai"."media_probe_results"
  ADD COLUMN IF NOT EXISTS "decoded_duration_ms" integer
  CHECK ("decoded_duration_ms" IS NULL OR ("decoded_duration_ms" > 0 AND "decoded_duration_ms" <= 7201000));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'learning_platform_media_probe'
  ) THEN
    RAISE EXCEPTION 'required role learning_platform_media_probe must exist before media audio chunk grants';
  END IF;
END
$$;

-- The probe role may only read and append manifest rows: no UPDATE or DELETE.
GRANT SELECT (
  "id", "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "deletion_fence", "chunk_index", "bucket", "object_key", "version_id", "etag",
  "sha256", "content_length", "body_start_ms", "body_end_ms", "file_start_ms",
  "file_end_ms", "created_at"
)
ON TABLE "ai"."media_audio_chunks"
TO "learning_platform_media_probe";

GRANT INSERT (
  "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "deletion_fence", "chunk_index", "bucket", "object_key", "version_id", "etag",
  "sha256", "content_length", "body_start_ms", "body_end_ms", "file_start_ms",
  "file_end_ms"
)
ON TABLE "ai"."media_audio_chunks"
TO "learning_platform_media_probe";

GRANT SELECT ("decoded_duration_ms")
ON TABLE "ai"."media_probe_results"
TO "learning_platform_media_probe";

GRANT INSERT ("decoded_duration_ms")
ON TABLE "ai"."media_probe_results"
TO "learning_platform_media_probe";
