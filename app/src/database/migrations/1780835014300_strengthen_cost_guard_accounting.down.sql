ALTER TABLE "ai"."owner_credit_wallets"
  ADD CONSTRAINT "owner_credit_wallets_available_credits_check" CHECK ("available_credits" >= 0) NOT VALID;

ALTER TABLE "ai"."credit_ledger_entries"
  DROP CONSTRAINT "credit_ledger_entries_entry_type_check";
ALTER TABLE "ai"."credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_entry_type_check"
  CHECK ("entry_type" IN ('RESERVE', 'SETTLE', 'RELEASE')) NOT VALID;

ALTER TABLE "ai"."provider_usage_records"
  DROP COLUMN IF EXISTS "charged_credits";
