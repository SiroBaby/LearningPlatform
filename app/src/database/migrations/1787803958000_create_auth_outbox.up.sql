-- Durable auth -> queue cancellation command seam.
-- Status changes and this command are committed in the auth transaction;
-- queue ownership applies the command asynchronously.
CREATE TABLE IF NOT EXISTS "auth"."outbox" (
    "id" bigserial PRIMARY KEY,
    "aggregate_id" uuid NOT NULL,
    "event_type" varchar(80) NOT NULL,
    "idempotency_key" varchar(128) NOT NULL,
    "payload" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "published_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_outbox_idempotency_key"
    ON "auth"."outbox" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_auth_outbox_unpublished"
    ON "auth"."outbox" ("created_at") WHERE "published_at" IS NULL;
