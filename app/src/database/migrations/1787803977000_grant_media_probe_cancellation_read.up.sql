-- Cancellation checks are part of every probe claim and fenced mutation.
-- Grant only the columns needed by those parameterized repository queries.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe') THEN
    RAISE EXCEPTION 'required role learning_platform_media_probe must exist before cancellation read grant';
  END IF;
END;
$$;

GRANT SELECT ("document_id", "owner_id", "deletion_fence")
ON TABLE "ai"."media_probe_cancellation_tombstones"
TO "learning_platform_media_probe";
