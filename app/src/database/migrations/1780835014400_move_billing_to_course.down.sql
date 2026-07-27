ALTER TABLE "course"."credit_ledger_entries" SET SCHEMA "ai";
ALTER TABLE "course"."owner_credit_wallets" SET SCHEMA "ai";
ALTER TABLE "course"."owner_entitlements" SET SCHEMA "ai";
ALTER TABLE "course"."documents"
  DROP COLUMN IF EXISTS "budget_status",
  DROP COLUMN IF EXISTS "settled_credits",
  DROP COLUMN IF EXISTS "estimated_credits",
  DROP COLUMN IF EXISTS "estimate_status",
  DROP COLUMN IF EXISTS "selected_model_label";
