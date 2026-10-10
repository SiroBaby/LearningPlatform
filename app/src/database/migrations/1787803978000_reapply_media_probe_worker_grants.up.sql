-- Re-apply the media-probe worker grants for databases where the dedicated
-- role was recreated after the original security migration ran.
-- Keep the repository SQL visible and parameterized; no SQL function hides
-- the state, lease, or deletion-fence rules.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'learning_platform_media_probe'
  ) THEN
    RAISE EXCEPTION 'required role learning_platform_media_probe must exist before media-probe grants';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA "ai" TO "learning_platform_media_probe";

GRANT SELECT ("document_id", "owner_id", "deletion_fence")
ON TABLE "ai"."media_probe_cancellation_tombstones"
TO "learning_platform_media_probe";

GRANT SELECT (
  "id", "document_id", "owner_id", "correlation_id", "probe_generation",
  "policy_version", "deletion_fence", "full_pipeline_job_id", "source_bucket",
  "source_key", "status", "attempts", "lease_id", "lease_until",
  "next_visible_at", "technical_retry_count", "failure_code", "error_message",
  "completed_at", "source_version_id", "source_etag", "source_content_length",
  "probe_result_id", "created_at", "updated_at"
)
ON TABLE "ai"."media_probe_jobs"
TO "learning_platform_media_probe";

GRANT UPDATE (
  "attempts", "lease_id", "lease_until", "status", "next_visible_at",
  "technical_retry_count", "failure_code", "error_message", "completed_at",
  "source_version_id", "source_etag", "source_content_length", "probe_result_id",
  "updated_at"
)
ON TABLE "ai"."media_probe_jobs"
TO "learning_platform_media_probe";

GRANT SELECT (
  "id", "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id", "created_at"
)
ON TABLE "ai"."media_probe_results"
TO "learning_platform_media_probe";

GRANT INSERT (
  "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id"
)
ON TABLE "ai"."media_probe_results"
TO "learning_platform_media_probe";

GRANT SELECT ("aggregate_id", "event_type")
ON TABLE "ai"."outbox"
TO "learning_platform_media_probe";

GRANT INSERT ("aggregate_id", "event_type", "payload")
ON TABLE "ai"."outbox"
TO "learning_platform_media_probe";

GRANT USAGE ON SEQUENCE "ai"."outbox_id_seq"
TO "learning_platform_media_probe";
