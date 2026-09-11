-- Keep media-probe rows attached to their Document. Physical Document deletion
-- cascades the queue row instead of leaving an AI orphan behind.
DO $$
BEGIN
  IF to_regclass('course.documents') IS NULL OR to_regclass('ai.media_probe_jobs') IS NULL THEN
    RAISE EXCEPTION 'media probe document foreign key requires both source tables';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_media_probe_jobs_document'
      AND conrelid = 'ai.media_probe_jobs'::regclass
  ) THEN
    ALTER TABLE "ai"."media_probe_jobs"
      ADD CONSTRAINT "fk_media_probe_jobs_document"
      FOREIGN KEY ("document_id")
      REFERENCES "course"."documents" ("id")
      ON DELETE CASCADE;
  END IF;
END;
$$;
