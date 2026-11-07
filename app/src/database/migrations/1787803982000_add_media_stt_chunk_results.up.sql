-- Per-chunk speech-to-text checkpoint for media Documents (#160 PR5, D6/D9 #2 of 3).
-- Expand-only and idempotent: one new table, no change to existing columns or grants.
-- Runtimes that predate this migration neither read nor write it, so rollout order between
-- API, probe, and full-pipeline workers does not matter. No trigger or SQL function: fence
-- predicates stay in repository SQL (SaveSTTOutcome locks the active FULL_PIPELINE job).
--
-- The full-pipeline worker connects as the application database role that owns the schema, so
-- it needs no extra GRANT; the media probe role gets no access to transcripts.
--
-- One row per (probe result, chunk, provider identity):
--   segments     JSONB array of timed segments relative to the chunk file; NULL while the chunk has
--                no usable result (an uncertain or invalid dispatch), '[]' for a silent chunk.
--   billed_ms    audio milliseconds the provider answered 2xx for (summed over every dispatch).
--   uncertain_ms audio milliseconds sent without a known outcome (timeout, 408/5xx, lost response).
-- Both counters only grow; the terminal transaction of the job reads and deletes them so the spend
-- of every attempt reaches the return seam once (usage.sttBilledSeconds / sttUncertainSeconds).

CREATE TABLE IF NOT EXISTS "ai"."media_stt_chunk_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "probe_result_id" uuid NOT NULL,
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL CHECK ("chunk_index" >= 0),
  "stt_provider_identity" char(64) NOT NULL CHECK ("stt_provider_identity" ~ '^[0-9a-f]{64}$'),
  "segments" jsonb CHECK ("segments" IS NULL OR jsonb_typeof("segments") = 'array'),
  "billed_ms" integer NOT NULL DEFAULT 0 CHECK ("billed_ms" >= 0),
  "uncertain_ms" integer NOT NULL DEFAULT 0 CHECK ("uncertain_ms" >= 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Hard-deleting the probe result (Document purge cascade) removes the transcript with it.
  CONSTRAINT "fk_media_stt_chunk_results_probe_result"
    FOREIGN KEY ("probe_result_id")
    REFERENCES "ai"."media_probe_results" ("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_media_stt_chunk_results_chunk_identity"
  ON "ai"."media_stt_chunk_results" ("probe_result_id", "chunk_index", "stt_provider_identity");
CREATE INDEX IF NOT EXISTS "idx_media_stt_chunk_results_document"
  ON "ai"."media_stt_chunk_results" ("document_id", "owner_id");
