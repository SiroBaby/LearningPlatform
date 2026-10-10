-- The probe worker learns the immutable object identity at first claim.
-- Keep the privilege narrow: it may fill the three locator fields, but it
-- cannot rewrite the managed bucket/key or any other job field through this
-- grant.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'learning_platform_media_probe') THEN
    RAISE EXCEPTION 'required role learning_platform_media_probe must exist before locator grant';
  END IF;
END;
$$;

GRANT UPDATE ("source_version_id", "source_etag", "source_content_length")
ON TABLE "ai"."media_probe_jobs"
TO "learning_platform_media_probe";
