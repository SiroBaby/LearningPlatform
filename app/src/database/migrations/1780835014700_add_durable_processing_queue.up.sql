-- ADR-0023 durable queue state. Existing rows remain immediately claimable.
ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN IF NOT EXISTS "lease_id" uuid,
  ADD COLUMN IF NOT EXISTS "lease_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "next_visible_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "technical_retry_count" int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failure_code" varchar(80),
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;

ALTER TABLE "ai"."processing_jobs"
  ADD CONSTRAINT "chk_processing_jobs_technical_retry_count"
  CHECK ("technical_retry_count" >= 0) NOT VALID;
ALTER TABLE "ai"."processing_jobs"
  VALIDATE CONSTRAINT "chk_processing_jobs_technical_retry_count";

CREATE INDEX IF NOT EXISTS "idx_processing_jobs_claimable"
  ON "ai"."processing_jobs" ("next_visible_at", "created_at")
  WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "idx_processing_jobs_expired_lease"
  ON "ai"."processing_jobs" ("lease_until")
  WHERE "status" = 'RUNNING';

CREATE TABLE IF NOT EXISTS "ai"."processing_job_dlq" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL UNIQUE,
  "document_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "last_attempt" int NOT NULL,
  "reason_code" varchar(80) NOT NULL,
  "moved_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS "idx_processing_job_dlq_expires_at"
  ON "ai"."processing_job_dlq" ("expires_at");
