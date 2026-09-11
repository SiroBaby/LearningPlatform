-- Durable Document deletion fence and retryable purge handoff.
-- Physical object deletion is intentionally owned by a later purge worker.

ALTER TABLE "course"."documents"
  DROP CONSTRAINT IF EXISTS "chk_documents_status";
ALTER TABLE "course"."documents"
  ADD CONSTRAINT "chk_documents_status"
  CHECK ("status" IN ('UPLOADED', 'PROBING', 'PROCESSING', 'READY', 'FAILED', 'DELETING'));

CREATE TABLE IF NOT EXISTS "course"."document_purge_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "deletion_fence" bigint NOT NULL CHECK ("deletion_fence" >= 0),
  "idempotency_key" varchar(160) NOT NULL,
  "locators" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
  "last_error_code" varchar(80),
  "last_error_message" text,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "purged_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_document_purge_manifest_locators_array"
    CHECK (jsonb_typeof("locators") = 'array'),
  CONSTRAINT "chk_document_purge_manifest_status"
    CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_purge_manifest_document"
  ON "course"."document_purge_manifests" ("document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_purge_manifest_idempotency_key"
  ON "course"."document_purge_manifests" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_document_purge_manifest_claimable"
  ON "course"."document_purge_manifests" ("next_attempt_at", "created_at")
  WHERE "status" IN ('PENDING', 'FAILED');

-- The forward relay must leave this event for the future purge consumer.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_course_outbox_document_purge"
  ON "course"."outbox" ("aggregate_id", "event_type")
  WHERE "event_type" = 'DocumentPurgeRequested';
