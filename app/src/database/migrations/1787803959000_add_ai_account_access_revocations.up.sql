-- Durable auth -> AI cancellation projection.
-- This table intentionally has no FK to auth.users: the AI queue consumes
-- an immutable cancellation marker without crossing the identity boundary.
CREATE TABLE IF NOT EXISTS "ai"."account_access_revocations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "reason_code" varchar(64) NOT NULL,
    "event_idempotency_key" varchar(128) NOT NULL,
    "revoked_at" timestamptz NOT NULL DEFAULT now(),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "chk_ai_account_access_revocations_reason_code"
      CHECK (char_length(btrim("reason_code")) > 0),
    CONSTRAINT "chk_ai_account_access_revocations_event_key"
      CHECK (char_length(btrim("event_idempotency_key")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_account_access_revocations_event_key"
    ON "ai"."account_access_revocations" ("event_idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_ai_account_access_revocations_user_time"
    ON "ai"."account_access_revocations" ("user_id", "revoked_at" DESC);

-- Existing jobs remain valid and claimable. Cancellation is additive: the
-- queue owner can fence pending/running work without changing old payloads.
ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN IF NOT EXISTS "cancellation_marker_id" uuid,
  ADD COLUMN IF NOT EXISTS "cancellation_reason" varchar(64),
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_ai_processing_jobs_cancellation"
    ON "ai"."processing_jobs" ("owner_id", "status", "updated_at")
    WHERE "status" IN ('PENDING', 'RUNNING');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ai_processing_jobs_status'
      AND conrelid = 'ai.processing_jobs'::regclass
  ) THEN
    ALTER TABLE "ai"."processing_jobs"
      ADD CONSTRAINT "chk_ai_processing_jobs_status"
      CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE "ai"."processing_jobs"
  VALIDATE CONSTRAINT "chk_ai_processing_jobs_status";
