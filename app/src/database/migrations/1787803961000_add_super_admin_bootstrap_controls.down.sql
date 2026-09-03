DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "auth"."super_admin_external_approval_consumptions") THEN
    RAISE EXCEPTION 'Cannot revert SUPER_ADMIN bootstrap controls while external approvals have been consumed';
  END IF;
END $$;

DROP INDEX IF EXISTS "auth"."idx_auth_super_admin_external_approval_target";
DROP TABLE IF EXISTS "auth"."super_admin_external_approval_consumptions";
DROP INDEX IF EXISTS "auth"."idx_auth_super_admin_role_change_requests_pending_expiry";
ALTER TABLE "auth"."super_admin_role_change_requests" DROP COLUMN IF EXISTS "expires_at";
ALTER TABLE "auth"."super_admin_audit_events"
  DROP COLUMN IF EXISTS "actor_user_id",
  DROP COLUMN IF EXISTS "metadata";
