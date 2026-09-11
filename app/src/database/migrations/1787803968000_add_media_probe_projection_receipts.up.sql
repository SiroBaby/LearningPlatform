-- Content-owned receipt for the cross-schema media-probe handoff.
-- The AI transaction owns media_probe_results; this receipt lets the course
-- projection validate and deduplicate the trusted return event without
-- crossing the schema transaction boundary from ADR-0023.

CREATE TABLE IF NOT EXISTS "course"."document_probe_receipts" (
  "probe_result_id" uuid PRIMARY KEY,
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "full_pipeline_job_id" uuid NOT NULL,
  "probe_generation" uuid NOT NULL,
  "policy_version" varchar(80) NOT NULL CHECK (length(btrim("policy_version")) > 0),
  "deletion_fence" bigint NOT NULL CHECK ("deletion_fence" >= 0),
  "duration_sec" integer NOT NULL CHECK ("duration_sec" > 0 AND "duration_sec" <= 7200),
  "source_bucket" varchar(255) NOT NULL CHECK (length(btrim("source_bucket")) > 0),
  "source_key" varchar(500) NOT NULL CHECK (length(btrim("source_key")) > 0),
  "source_version_id" varchar(255) NOT NULL CHECK (length(btrim("source_version_id")) > 0),
  "source_etag" varchar(255) NOT NULL CHECK (length(btrim("source_etag")) > 0),
  "source_content_length" bigint NOT NULL CHECK ("source_content_length" >= 0),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_probe_receipt_job"
  ON "course"."document_probe_receipts" ("full_pipeline_job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_probe_receipt_generation"
  ON "course"."document_probe_receipts" ("document_id", "probe_generation", "policy_version");
