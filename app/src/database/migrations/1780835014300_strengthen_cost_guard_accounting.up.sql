ALTER TABLE "ai"."provider_usage_records"
  ADD COLUMN "charged_credits" bigint CHECK ("charged_credits" IS NULL OR "charged_credits" >= 0);

ALTER TABLE "ai"."credit_ledger_entries"
  DROP CONSTRAINT "credit_ledger_entries_entry_type_check";
ALTER TABLE "ai"."credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_entry_type_check"
  CHECK ("entry_type" IN ('RESERVE', 'SETTLE', 'RELEASE', 'HOLD'));

ALTER TABLE "ai"."owner_credit_wallets"
  DROP CONSTRAINT "owner_credit_wallets_available_credits_check";
