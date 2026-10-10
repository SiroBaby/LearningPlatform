REVOKE SELECT ("document_id", "owner_id", "deletion_fence")
ON TABLE "ai"."media_probe_cancellation_tombstones"
FROM "learning_platform_media_probe";
