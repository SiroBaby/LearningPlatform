ALTER TABLE "ai"."owner_entitlements" SET SCHEMA "course";
ALTER TABLE "ai"."owner_credit_wallets" SET SCHEMA "course";
ALTER TABLE "ai"."credit_ledger_entries" SET SCHEMA "course";

ALTER TABLE "course"."documents"
  ADD COLUMN "selected_model_label" varchar(120),
  ADD COLUMN "estimate_status" varchar(20),
  ADD COLUMN "estimated_credits" bigint,
  ADD COLUMN "settled_credits" bigint,
  ADD COLUMN "budget_status" varchar(20);
