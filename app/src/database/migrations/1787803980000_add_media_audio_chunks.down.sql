-- Rolling back drops derived audio manifest rows and the decoded duration. The
-- S3 objects are untouched: they were captured by purge manifests on deletion
-- and otherwise expire through the derived-audio/ lifecycle rule.
DROP TABLE IF EXISTS "ai"."media_audio_chunks";

ALTER TABLE "ai"."media_probe_results"
  DROP COLUMN IF EXISTS "decoded_duration_ms";
