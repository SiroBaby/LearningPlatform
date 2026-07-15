-- Migration: 1780835013900_create_ai_chunks (up)
-- ai.chunks is the durable full-text source of truth (ADR-0017).

CREATE TABLE IF NOT EXISTS "ai"."chunks" (
    "id"           uuid PRIMARY KEY,
    "document_id"  uuid NOT NULL,
    "owner_id"     uuid NOT NULL,
    "chunk_index"  integer NOT NULL CHECK ("chunk_index" >= 0),
    "text"         text NOT NULL CHECK (length(btrim("text")) > 0),
    "locator"      jsonb NOT NULL,
    "page_number"  integer CHECK ("page_number" IS NULL OR "page_number" > 0),
    "start_sec"    numeric(12, 3),
    "end_sec"      numeric(12, 3),
    "content_hash" varchar(64) NOT NULL,
    "created_at"   timestamptz NOT NULL DEFAULT now(),
    "updated_at"   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "chk_chunk_time_range"
      CHECK ("start_sec" IS NULL OR "end_sec" IS NULL OR "start_sec" <= "end_sec")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_chunks_document_owner_index"
    ON "ai"."chunks" ("document_id", "owner_id", "chunk_index");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chunks_document_owner_hash_index"
    ON "ai"."chunks" ("document_id", "owner_id", "content_hash", "chunk_index");
CREATE INDEX IF NOT EXISTS "idx_chunks_owner_document_order"
    ON "ai"."chunks" ("owner_id", "document_id", "chunk_index");
