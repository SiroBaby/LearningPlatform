-- Media probe queue contract.
--
-- Probe work has its own AI-owned tables. The full-pipeline queue remains
-- responsible only for FULL_PIPELINE jobs; this keeps the worker boundary
-- visible in the schema instead of hiding it in a large database operation.

ALTER TABLE "course"."documents"
  ADD COLUMN IF NOT EXISTS "probe_generation" uuid,
  ADD COLUMN IF NOT EXISTS "probe_policy_version" varchar(80),
  ADD COLUMN IF NOT EXISTS "deletion_fence" bigint NOT NULL DEFAULT 0;

-- The old backstop covered every job type. FULL_PIPELINE is the only job
-- type stored here after this migration.
DROP INDEX IF EXISTS "ai"."uq_job_document_type";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_processing_jobs_full_pipeline_document"
  ON "ai"."processing_jobs" ("document_id")
  WHERE "job_type" = 'FULL_PIPELINE';

ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN IF NOT EXISTS "probe_generation" uuid,
  ADD COLUMN IF NOT EXISTS "policy_version" varchar(80),
  ADD COLUMN IF NOT EXISTS "deletion_fence" bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "probe_result_id" uuid;

CREATE TABLE IF NOT EXISTS "ai"."media_probe_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "probe_generation" uuid NOT NULL,
  "policy_version" varchar(80) NOT NULL CHECK (length(btrim("policy_version")) > 0),
  "deletion_fence" bigint NOT NULL DEFAULT 0 CHECK ("deletion_fence" >= 0),
  "full_pipeline_job_id" uuid NOT NULL,
  "source_bucket" varchar(255) NOT NULL CHECK (length(btrim("source_bucket")) > 0),
  "source_key" varchar(500) NOT NULL CHECK (length(btrim("source_key")) > 0),
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "idempotency_key" varchar(128) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "lease_id" uuid,
  "lease_until" timestamptz,
  "next_visible_at" timestamptz NOT NULL DEFAULT now(),
  "technical_retry_count" integer NOT NULL DEFAULT 0 CHECK ("technical_retry_count" >= 0),
  "failure_code" varchar(80),
  "error_message" text,
  "completed_at" timestamptz,
  "source_version_id" varchar(255),
  "source_etag" varchar(255),
  "source_content_length" bigint CHECK ("source_content_length" IS NULL OR "source_content_length" >= 0),
  "probe_result_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_media_probe_jobs_status"
    CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "chk_media_probe_jobs_locator_all_or_none"
    CHECK (("source_version_id" IS NULL AND "source_etag" IS NULL AND "source_content_length" IS NULL)
      OR (length(btrim("source_version_id")) > 0 AND length(btrim("source_etag")) > 0 AND "source_content_length" >= 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_job_idempotency_key"
  ON "ai"."media_probe_jobs" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_job_generation"
  ON "ai"."media_probe_jobs" ("document_id", "probe_generation", "policy_version");
CREATE INDEX IF NOT EXISTS "idx_media_probe_jobs_claimable"
  ON "ai"."media_probe_jobs" ("next_visible_at", "created_at")
  WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "idx_media_probe_jobs_expired_lease"
  ON "ai"."media_probe_jobs" ("lease_until")
  WHERE "status" = 'RUNNING';

CREATE TABLE IF NOT EXISTS "ai"."media_probe_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "media_probe_job_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "probe_generation" uuid NOT NULL,
  "policy_version" varchar(80) NOT NULL CHECK (length(btrim("policy_version")) > 0),
  "deletion_fence" bigint NOT NULL CHECK ("deletion_fence" >= 0),
  "duration_sec" integer NOT NULL CHECK ("duration_sec" > 0 AND "duration_sec" <= 7200),
  "bucket" varchar(255) NOT NULL CHECK (length(btrim("bucket")) > 0),
  "object_key" varchar(500) NOT NULL CHECK (length(btrim("object_key")) > 0),
  "version_id" varchar(255) NOT NULL CHECK (length(btrim("version_id")) > 0),
  "etag" varchar(255) NOT NULL CHECK (length(btrim("etag")) > 0),
  "content_length" bigint NOT NULL CHECK ("content_length" >= 0),
  "full_pipeline_job_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "fk_media_probe_results_job"
    FOREIGN KEY ("media_probe_job_id")
    REFERENCES "ai"."media_probe_jobs" ("id")
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_result_job_id"
  ON "ai"."media_probe_results" ("media_probe_job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_result_generation"
  ON "ai"."media_probe_results" ("document_id", "probe_generation", "policy_version");

ALTER TABLE "ai"."processing_jobs"
  ADD CONSTRAINT "fk_processing_jobs_probe_result"
  FOREIGN KEY ("probe_result_id")
  REFERENCES "ai"."media_probe_results" ("id")
  ON DELETE RESTRICT;

-- The probe role can read and write only its dedicated AI queue/result/outbox
-- surface. It has no course, full-pipeline, credit, or delete-version access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe') THEN
    RAISE EXCEPTION 'required role learning_platform_media_probe must exist before media probe migration';
  END IF;
END;
$$;

-- The runtime role receives only EXECUTE on narrow operations in the later
-- security migration; it never receives direct table or sequence grants.
GRANT USAGE ON SCHEMA "ai" TO "learning_platform_media_probe";
