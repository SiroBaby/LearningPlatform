-- Migration: 1717700000000_create_documents (up)
-- Pure SQL. IF NOT EXISTS để chạy lại an toàn (idempotent).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS "documents" (
    "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_id"      uuid NOT NULL,
    "type"          varchar(20) NOT NULL,
    "original_name" varchar(500) NOT NULL,
    "storage_ref"   varchar(500) NOT NULL,
    "size_bytes"    bigint NOT NULL,
    "language"      varchar(10),
    "status"        varchar(20) NOT NULL DEFAULT 'UPLOADED',
    "duration_sec"  int,
    "page_count"    int,
    "error_message" text,
    "created_at"    timestamptz NOT NULL DEFAULT now(),
    "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_doc_owner" ON "documents" ("owner_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_doc_status" ON "documents" ("status") WHERE "status" != 'READY';
