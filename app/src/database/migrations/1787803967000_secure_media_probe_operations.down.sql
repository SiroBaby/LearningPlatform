REVOKE SELECT (
  "id", "document_id", "owner_id", "correlation_id", "probe_generation",
  "policy_version", "deletion_fence", "full_pipeline_job_id", "source_bucket",
  "source_key", "status", "attempts", "lease_id", "lease_until",
  "next_visible_at", "technical_retry_count", "failure_code", "error_message",
  "completed_at", "source_version_id", "source_etag", "source_content_length",
  "probe_result_id", "created_at", "updated_at"
)
ON TABLE "ai"."media_probe_jobs" FROM "learning_platform_media_probe";
REVOKE UPDATE (
  "attempts", "lease_id", "lease_until", "status", "next_visible_at",
  "technical_retry_count", "failure_code", "error_message", "completed_at",
  "probe_result_id", "updated_at"
)
ON TABLE "ai"."media_probe_jobs" FROM "learning_platform_media_probe";
REVOKE SELECT (
  "id", "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id", "created_at"
)
ON TABLE "ai"."media_probe_results" FROM "learning_platform_media_probe";
REVOKE INSERT (
  "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id"
)
ON TABLE "ai"."media_probe_results" FROM "learning_platform_media_probe";
REVOKE SELECT ("aggregate_id", "event_type")
ON TABLE "ai"."outbox" FROM "learning_platform_media_probe";
REVOKE INSERT ("aggregate_id", "event_type", "payload")
ON TABLE "ai"."outbox" FROM "learning_platform_media_probe";
REVOKE USAGE ON SEQUENCE "ai"."outbox_id_seq" FROM "learning_platform_media_probe";
REVOKE USAGE ON SCHEMA "ai" FROM "learning_platform_media_probe";
