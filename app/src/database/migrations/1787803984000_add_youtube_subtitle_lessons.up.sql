ALTER TABLE "course"."documents" ADD COLUMN IF NOT EXISTS "youtube_video_id" varchar(11);

ALTER TABLE "course"."documents" DROP CONSTRAINT IF EXISTS "chk_documents_youtube_video_id";
ALTER TABLE "course"."documents" ADD CONSTRAINT "chk_documents_youtube_video_id" CHECK (
  ("type" = 'YOUTUBE' AND "youtube_video_id" IS NOT NULL AND "youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$')
  OR ("type" <> 'YOUTUBE' AND "youtube_video_id" IS NULL));

CREATE TABLE IF NOT EXISTS "course"."document_subtitle_transcripts" (
  "document_id" uuid PRIMARY KEY REFERENCES "course"."documents" ("id") ON DELETE CASCADE,
  "owner_id" uuid NOT NULL,
  "source_format" varchar(3) NOT NULL CHECK ("source_format" IN ('VTT','SRT')),
  "source_sha256" char(64) NOT NULL CHECK ("source_sha256" ~ '^[0-9a-f]{64}$'),
  "source_size_bytes" integer NOT NULL CHECK ("source_size_bytes" BETWEEN 1 AND 5242880),
  "parser_version" varchar(40) NOT NULL,
  "cues" jsonb NOT NULL CHECK (jsonb_typeof("cues") = 'array'),
  "cue_count" integer NOT NULL CHECK ("cue_count" BETWEEN 1 AND 10000),
  "char_count" integer NOT NULL CHECK ("char_count" BETWEEN 1 AND 500000),
  "duration_ms" bigint NOT NULL CHECK ("duration_ms" > 0),
  "rights_confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_document_subtitle_cue_count" CHECK (jsonb_array_length("cues") = "cue_count"));

CREATE INDEX IF NOT EXISTS "idx_document_subtitle_transcripts_owner"
  ON "course"."document_subtitle_transcripts" ("owner_id", "document_id");
