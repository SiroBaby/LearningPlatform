-- Bind role-change approvals to the approver role state so expired temporary
-- SUPER_ADMIN sessions cannot keep their approval after demotion.
ALTER TABLE "auth"."users"
  ADD COLUMN IF NOT EXISTS "super_admin_role_epoch" bigint NOT NULL DEFAULT 0;

ALTER TABLE "auth"."super_admin_role_change_approvals"
  ADD COLUMN IF NOT EXISTS "approver_role_epoch" bigint NOT NULL DEFAULT 0;
