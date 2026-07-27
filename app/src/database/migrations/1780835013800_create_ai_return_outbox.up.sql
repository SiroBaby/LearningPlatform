-- Migration: 1780835013800_create_ai_return_outbox (up)
-- Durable return seam ai -> content (ADR-0013), owned exclusively by ai.

CREATE TABLE IF NOT EXISTS "ai"."outbox" (
    "id"           bigserial PRIMARY KEY,
    "aggregate_id" uuid NOT NULL,
    "event_type"   varchar(80) NOT NULL,
    "payload"      jsonb NOT NULL,
    "created_at"   timestamptz NOT NULL DEFAULT now(),
    "published_at" timestamptz NULL
);

CREATE INDEX IF NOT EXISTS "idx_ai_outbox_unpublished"
    ON "ai"."outbox" ("created_at") WHERE "published_at" IS NULL;
