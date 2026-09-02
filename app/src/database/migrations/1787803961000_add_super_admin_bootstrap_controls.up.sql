-- Additive controls for the initial four-account bootstrap and quorum recovery.
-- Existing role-change and audit rows remain valid during expand/contract rollout.
ALTER TABLE "auth"."super_admin_role_change_requests"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '30 minutes');
CREATE INDEX IF NOT EXISTS "idx_auth_super_admin_role_change_requests_pending_expiry"
  ON "auth"."super_admin_role_change_requests" ("expires_at")
  WHERE "completed_at" IS NULL;

ALTER TABLE "auth"."super_admin_audit_events"
  ADD COLUMN IF NOT EXISTS "actor_user_id" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "auth"."super_admin_external_approval_consumptions" (
  "jti_hash" varchar(128) PRIMARY KEY,
  "action" varchar(64) NOT NULL CHECK ("action" IN ('GRANT_BREAK_GLASS_SUPER_ADMIN', 'LOCKOUT_RECOVERY')),
  "environment" varchar(32) NOT NULL,
  "audience" varchar(255) NOT NULL,
  "target_user_id" uuid NOT NULL REFERENCES "auth"."users"("id"),
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "consumed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_auth_super_admin_external_approval_expiry"
    CHECK ("expires_at" > "created_at")
);
CREATE INDEX IF NOT EXISTS "idx_auth_super_admin_external_approval_target"
  ON "auth"."super_admin_external_approval_consumptions" ("target_user_id", "created_at");
