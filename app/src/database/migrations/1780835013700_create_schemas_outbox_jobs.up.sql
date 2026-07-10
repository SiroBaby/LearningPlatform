-- Migration: 1780835013700_create_schemas_outbox_jobs (up)
-- Pure SQL, idempotent. Scope issue 01: schema foundation + forward seam.
-- Tôn trọng ADR-0002 (outbox seam), 0005 (idempotency_key document-scoped),
-- 0010 (schema-per-service), 0012 (unique document_id+job_type), 0018 (owner_id data-plane).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ba schema tách biệt (ADR-0010)
CREATE SCHEMA IF NOT EXISTS "course";
CREATE SCHEMA IF NOT EXISTS "ai";
CREATE SCHEMA IF NOT EXISTS "quiz";

-- 2. Dời documents từ public sang course (forward-only, idempotent qua guard)
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'documents'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'course' AND table_name = 'documents'
     )
  THEN
    ALTER TABLE "public"."documents" SET SCHEMA "course";
  END IF;
END $$;

-- 3. course.outbox — forward seam content -> ai (ADR-0002)
--    payload mang owner_id để truyền danh tính qua data plane (ADR-0018)
CREATE TABLE IF NOT EXISTS "course"."outbox" (
    "id"           bigserial PRIMARY KEY,
    "aggregate_id" uuid NOT NULL,
    "event_type"   varchar(80) NOT NULL,
    "payload"      jsonb NOT NULL,
    "created_at"   timestamptz NOT NULL DEFAULT now(),
    "published_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "idx_course_outbox_unpublished"
    ON "course"."outbox" ("created_at") WHERE "published_at" IS NULL;

-- 4. ai.processing_jobs — hàng đợi việc (như Kafka tới Phase 2)
CREATE TABLE IF NOT EXISTS "ai"."processing_jobs" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "document_id"     uuid NOT NULL,
    "owner_id"        uuid NOT NULL,
    "job_type"        varchar(30) NOT NULL,
    "status"          varchar(20) NOT NULL DEFAULT 'PENDING',
    "idempotency_key" varchar(128) NOT NULL,
    "correlation_id"  uuid NOT NULL,
    "attempts"        int NOT NULL DEFAULT 0,
    "error_message"   text,
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz NOT NULL DEFAULT now()
);

-- idempotency_key document-scoped, unique (ADR-0005)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_idempotency_key"
    ON "ai"."processing_jobs" ("idempotency_key");
-- backstop: một document chỉ một job mỗi loại (ADR-0012)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_document_type"
    ON "ai"."processing_jobs" ("document_id", "job_type");
CREATE INDEX IF NOT EXISTS "idx_job_status"
    ON "ai"."processing_jobs" ("status", "created_at");
