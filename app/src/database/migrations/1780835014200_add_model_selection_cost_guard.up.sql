CREATE TYPE "course"."model_selection_kind" AS ENUM ('PLAN', 'CUSTOM');

ALTER TABLE "course"."documents"
  ADD COLUMN "model_selection_kind" "course"."model_selection_kind" NOT NULL DEFAULT 'PLAN',
  ADD COLUMN "platform_model_id" varchar(100) NOT NULL DEFAULT 'platform-default',
  ADD COLUMN "custom_model_config_id" uuid;

ALTER TABLE "course"."documents"
  ADD CONSTRAINT "chk_documents_model_selection"
  CHECK (
    ("model_selection_kind" = 'PLAN' AND "platform_model_id" IS NOT NULL AND "custom_model_config_id" IS NULL)
    OR
    ("model_selection_kind" = 'CUSTOM' AND "platform_model_id" IS NULL AND "custom_model_config_id" IS NOT NULL)
  );

ALTER TABLE "ai"."processing_jobs"
  ADD COLUMN "model_selection_kind" varchar(10),
  ADD COLUMN "platform_model_id" varchar(100),
  ADD COLUMN "custom_model_config_id" uuid;

CREATE TABLE "ai"."owner_model_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "display_name" varchar(120) NOT NULL CHECK (length(btrim("display_name")) > 0),
  "base_url" text NOT NULL CHECK (length(btrim("base_url")) > 0),
  "model" varchar(255) NOT NULL CHECK (length(btrim("model")) > 0),
  "capability_version" varchar(100) NOT NULL CHECK (length(btrim("capability_version")) > 0),
  "transport" varchar(30) NOT NULL CHECK ("transport" IN ('responses', 'chat-completions')),
  "structured_output_mode" varchar(30) NOT NULL CHECK ("structured_output_mode" IN ('json-object', 'json-schema-strict')),
  "api_key_ciphertext" text NOT NULL CHECK (length(btrim("api_key_ciphertext")) > 0),
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_owner_model_configs_owner_active" ON "ai"."owner_model_configs" ("owner_id", "is_active", "created_at" DESC);

CREATE TABLE "ai"."owner_entitlements" (
  "owner_id" uuid PRIMARY KEY,
  "plan_id" varchar(100) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ai"."owner_credit_wallets" (
  "owner_id" uuid PRIMARY KEY,
  "available_credits" bigint NOT NULL CHECK ("available_credits" >= 0),
  "reserved_credits" bigint NOT NULL DEFAULT 0 CHECK ("reserved_credits" >= 0),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ai"."credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "job_attempt" integer NOT NULL CHECK ("job_attempt" > 0),
  "business_key" varchar(180) NOT NULL,
  "entry_type" varchar(20) NOT NULL CHECK ("entry_type" IN ('RESERVE', 'SETTLE', 'RELEASE')),
  "credits" bigint NOT NULL CHECK ("credits" >= 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("business_key")
);
CREATE INDEX "idx_credit_ledger_owner_job" ON "ai"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt");

CREATE TABLE "ai"."provider_usage_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "job_attempt" integer NOT NULL CHECK ("job_attempt" > 0),
  "request_key" varchar(180) NOT NULL,
  "provider_identity" varchar(128) NOT NULL,
  "input_tokens" bigint,
  "output_tokens" bigint,
  "cached" boolean NOT NULL DEFAULT false,
  "usage_status" varchar(20) NOT NULL CHECK ("usage_status" IN ('AVAILABLE', 'UNAVAILABLE')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("request_key")
);
