DROP TABLE IF EXISTS "ai"."provider_usage_records";
DROP TABLE IF EXISTS "ai"."credit_ledger_entries";
DROP TABLE IF EXISTS "ai"."owner_credit_wallets";
DROP TABLE IF EXISTS "ai"."owner_entitlements";
DROP TABLE IF EXISTS "ai"."owner_model_configs";

ALTER TABLE "ai"."processing_jobs"
  DROP COLUMN IF EXISTS "custom_model_config_id",
  DROP COLUMN IF EXISTS "platform_model_id",
  DROP COLUMN IF EXISTS "model_selection_kind";

ALTER TABLE "course"."documents"
  DROP CONSTRAINT IF EXISTS "chk_documents_model_selection";
ALTER TABLE "course"."documents"
  DROP COLUMN IF EXISTS "custom_model_config_id",
  DROP COLUMN IF EXISTS "platform_model_id",
  DROP COLUMN IF EXISTS "model_selection_kind";
DROP TYPE IF EXISTS "course"."model_selection_kind";
