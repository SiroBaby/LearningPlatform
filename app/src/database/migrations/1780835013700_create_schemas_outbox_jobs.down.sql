-- Migration: 1780835013700_create_schemas_outbox_jobs (down)
-- Pure SQL, idempotent.

DROP TABLE IF EXISTS "ai"."processing_jobs";
DROP TABLE IF EXISTS "course"."outbox";

-- Dời documents về public (đảo ngược bước up)
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'course' AND table_name = 'documents'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'documents'
     )
  THEN
    ALTER TABLE "course"."documents" SET SCHEMA "public";
  END IF;
END $$;

DROP SCHEMA IF EXISTS "quiz";
DROP SCHEMA IF EXISTS "ai";
DROP SCHEMA IF EXISTS "course";
