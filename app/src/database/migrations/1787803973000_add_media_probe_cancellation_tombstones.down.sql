DROP INDEX IF EXISTS "ai"."idx_media_probe_cancellation_tombstone_document";
DROP INDEX IF EXISTS "ai"."uq_media_probe_cancellation_tombstone_event_key";
DROP INDEX IF EXISTS "ai"."uq_media_probe_cancellation_tombstone_fence";
DROP TABLE IF EXISTS "ai"."media_probe_cancellation_tombstones";
