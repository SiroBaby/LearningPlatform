-- Direct, least-privilege access for media-probe repository operations.
-- Business transitions stay in parameterized Go transactions so the state,
-- attempt, lease, deletion fence, and locator predicates remain readable.

REVOKE ALL ON SCHEMA "ai" FROM "learning_platform_media_probe";
GRANT USAGE ON SCHEMA "ai" TO "learning_platform_media_probe";

REVOKE ALL ON TABLE "ai"."media_probe_jobs" FROM "learning_platform_media_probe";
GRANT SELECT (
  "id", "document_id", "owner_id", "correlation_id", "probe_generation",
  "policy_version", "deletion_fence", "full_pipeline_job_id", "source_bucket",
  "source_key", "status", "attempts", "lease_id", "lease_until",
  "next_visible_at", "technical_retry_count", "failure_code", "error_message",
  "completed_at", "source_version_id", "source_etag", "source_content_length",
  "probe_result_id", "created_at", "updated_at"
)
ON TABLE "ai"."media_probe_jobs" TO "learning_platform_media_probe";
GRANT UPDATE (
  "attempts", "lease_id", "lease_until", "status", "next_visible_at",
  "technical_retry_count", "failure_code", "error_message", "completed_at",
  "probe_result_id", "updated_at"
)
ON TABLE "ai"."media_probe_jobs" TO "learning_platform_media_probe";
-- Source locator columns are intentionally absent from UPDATE: the API
-- captures them at enqueue time, and probe retries must reuse that identity.

REVOKE ALL ON TABLE "ai"."media_probe_results" FROM "learning_platform_media_probe";
GRANT SELECT (
  "id", "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id", "created_at"
)
ON TABLE "ai"."media_probe_results" TO "learning_platform_media_probe";
GRANT INSERT (
  "media_probe_job_id", "document_id", "owner_id", "probe_generation",
  "policy_version", "deletion_fence", "duration_sec", "bucket", "object_key",
  "version_id", "etag", "content_length", "full_pipeline_job_id"
)
ON TABLE "ai"."media_probe_results" TO "learning_platform_media_probe";

REVOKE ALL ON TABLE "ai"."outbox" FROM "learning_platform_media_probe";
GRANT SELECT ("aggregate_id", "event_type")
ON TABLE "ai"."outbox" TO "learning_platform_media_probe";
GRANT INSERT ("aggregate_id", "event_type", "payload")
ON TABLE "ai"."outbox" TO "learning_platform_media_probe";
REVOKE ALL ON SEQUENCE "ai"."outbox_id_seq" FROM "learning_platform_media_probe";
GRANT USAGE ON SEQUENCE "ai"."outbox_id_seq" TO "learning_platform_media_probe";
