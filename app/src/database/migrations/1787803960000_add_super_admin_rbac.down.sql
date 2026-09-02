DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Cannot revert SUPER_ADMIN RBAC while SUPER_ADMIN accounts exist';
  END IF;

  IF EXISTS (SELECT 1 FROM "auth"."super_admin_role_change_requests")
    OR EXISTS (SELECT 1 FROM "auth"."super_admin_role_change_approvals")
    OR EXISTS (SELECT 1 FROM "auth"."super_admin_audit_events") THEN
    RAISE EXCEPTION 'Cannot revert SUPER_ADMIN RBAC while role-change or audit history exists';
  END IF;
END $$;

DROP TABLE IF EXISTS "auth"."super_admin_audit_events";
DROP TABLE IF EXISTS "auth"."super_admin_role_change_approvals";
DROP TABLE IF EXISTS "auth"."super_admin_role_change_requests";
DROP FUNCTION IF EXISTS "auth"."reject_super_admin_audit_event_mutation"();
ALTER TABLE "auth"."users" DROP COLUMN IF EXISTS "super_admin_expires_at";
ALTER TABLE "auth"."users" DROP CONSTRAINT IF EXISTS "chk_auth_users_role";
ALTER TABLE "auth"."users"
  ADD CONSTRAINT "chk_auth_users_role" CHECK ("role" IN ('USER', 'ADMIN'));
