-- Replace the legacy role check to admit SUPER_ADMIN; existing USER and ADMIN rows remain untouched,
-- and VALIDATE confirms compatibility without a data rewrite or backfill.
ALTER TABLE "auth"."users" DROP CONSTRAINT IF EXISTS "chk_auth_users_role";
ALTER TABLE "auth"."users"
  ADD CONSTRAINT "chk_auth_users_role"
  CHECK ("role" IN ('USER', 'ADMIN', 'SUPER_ADMIN')) NOT VALID;
ALTER TABLE "auth"."users" VALIDATE CONSTRAINT "chk_auth_users_role";
ALTER TABLE "auth"."users"
  ADD COLUMN IF NOT EXISTS "super_admin_expires_at" timestamptz;

CREATE TABLE IF NOT EXISTS "auth"."super_admin_role_change_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "requester_id" uuid NOT NULL REFERENCES "auth"."users"("id"),
  "target_user_id" uuid NOT NULL REFERENCES "auth"."users"("id"),
  "desired_role" varchar(16) NOT NULL CHECK ("desired_role" IN ('ADMIN', 'SUPER_ADMIN')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE TABLE IF NOT EXISTS "auth"."super_admin_role_change_approvals" (
  "request_id" uuid NOT NULL REFERENCES "auth"."super_admin_role_change_requests"("id") ON DELETE CASCADE,
  "approver_id" uuid NOT NULL REFERENCES "auth"."users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("request_id", "approver_id")
);
CREATE TABLE IF NOT EXISTS "auth"."super_admin_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type" varchar(64) NOT NULL,
  "target_user_id" uuid NOT NULL REFERENCES "auth"."users"("id"),
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION "auth"."reject_super_admin_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SUPER_ADMIN audit events are immutable';
END;
$$;

CREATE TRIGGER "trg_auth_super_admin_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "auth"."super_admin_audit_events"
FOR EACH ROW EXECUTE FUNCTION "auth"."reject_super_admin_audit_event_mutation"();
