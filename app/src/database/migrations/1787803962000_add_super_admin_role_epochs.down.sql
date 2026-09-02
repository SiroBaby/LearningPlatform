ALTER TABLE "auth"."super_admin_role_change_approvals"
  DROP COLUMN IF EXISTS "approver_role_epoch";

ALTER TABLE "auth"."users"
  DROP COLUMN IF EXISTS "super_admin_role_epoch";
