-- AI-owned cancellation markers close the relay window between Document
-- deletion and delivery of DocumentProcessingCancelled.
-- No foreign key is intentional: the marker must outlive the Document row.

CREATE TABLE IF NOT EXISTS "ai"."media_probe_cancellation_tombstones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "deletion_fence" bigint NOT NULL CHECK ("deletion_fence" >= 0),
  "reason" varchar(64) NOT NULL CHECK (length(btrim("reason")) > 0),
  "event_idempotency_key" varchar(160) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_cancellation_tombstone_fence"
  ON "ai"."media_probe_cancellation_tombstones" ("document_id", "owner_id", "deletion_fence");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_probe_cancellation_tombstone_event_key"
  ON "ai"."media_probe_cancellation_tombstones" ("event_idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_media_probe_cancellation_tombstone_document"
  ON "ai"."media_probe_cancellation_tombstones" ("document_id", "owner_id", "deletion_fence" DESC);
