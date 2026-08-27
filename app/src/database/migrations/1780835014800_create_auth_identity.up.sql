-- ADR-0024: durable identity, profile, session, and OAuth transaction state.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS "auth";

CREATE TABLE IF NOT EXISTS "auth"."users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "google_sub" varchar(255) NOT NULL,
    "normalized_email" varchar(320) NOT NULL,
    "email_verified" boolean NOT NULL DEFAULT true,
    "role" varchar(16) NOT NULL DEFAULT 'USER',
    "status" varchar(16) NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "chk_auth_users_role" CHECK ("role" IN ('USER', 'ADMIN')),
    CONSTRAINT "chk_auth_users_status" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
    CONSTRAINT "chk_auth_users_deleted_at" CHECK (("status" = 'DELETED') = ("deleted_at" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_users_google_sub"
    ON "auth"."users" ("google_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_users_normalized_email"
    ON "auth"."users" ("normalized_email");
CREATE INDEX IF NOT EXISTS "idx_auth_users_status"
    ON "auth"."users" ("status");

CREATE TABLE IF NOT EXISTS "auth"."user_profiles" (
    "user_id" uuid PRIMARY KEY,
    "display_name" varchar(200),
    "avatar_url" varchar(2_000),
    "learning_goal" varchar(80),
    "preferred_language" varchar(16),
    "proficiency_level" varchar(16),
    "onboarding_completed_at" timestamptz,
    "onboarding_skipped_at" timestamptz,
    CONSTRAINT "fk_auth_user_profiles_user"
      FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE,
    CONSTRAINT "chk_auth_user_profiles_preferred_language"
      CHECK ("preferred_language" IS NULL OR "preferred_language" IN ('vi', 'en')),
    CONSTRAINT "chk_auth_user_profiles_proficiency_level"
      CHECK ("proficiency_level" IS NULL OR "proficiency_level" IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
    CONSTRAINT "chk_auth_user_profiles_onboarding_state"
      CHECK (NOT ("onboarding_completed_at" IS NOT NULL AND "onboarding_skipped_at" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "auth"."sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL,
    "session_family_id" uuid NOT NULL,
    "token_type" varchar(16) NOT NULL,
    "token_hash" varchar(128) NOT NULL,
    "previous_token_hash" varchar(128),
    "rotation_counter" integer NOT NULL DEFAULT 0,
    "expires_at" timestamptz NOT NULL,
    "processing_at" timestamptz,
    "revoked_at" timestamptz,
    "revoked_reason" varchar(64),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "last_used_at" timestamptz,
    CONSTRAINT "fk_auth_sessions_user"
      FOREIGN KEY ("user_id") REFERENCES "auth"."users" ("id") ON DELETE CASCADE,
    CONSTRAINT "chk_auth_sessions_token_type"
      CHECK ("token_type" IN ('ACCESS', 'REFRESH')),
    CONSTRAINT "chk_auth_sessions_rotation_counter"
      CHECK ("rotation_counter" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_sessions_token_hash"
    ON "auth"."sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_family"
    ON "auth"."sessions" ("session_family_id");
CREATE INDEX IF NOT EXISTS "idx_auth_sessions_active_user"
    ON "auth"."sessions" ("user_id", "revoked_at");

CREATE TABLE IF NOT EXISTS "auth"."oauth_transactions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "state_hash" varchar(128) NOT NULL,
    "nonce_hash" varchar(128) NOT NULL,
    "pkce_verifier_ciphertext" bytea NOT NULL,
    "environment" varchar(32) NOT NULL,
    "max_attempts" integer NOT NULL DEFAULT 5,
    "attempt_count" integer NOT NULL DEFAULT 0,
    "expires_at" timestamptz NOT NULL,
    "consumed_at" timestamptz,
    "failed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "chk_auth_oauth_transactions_attempts"
      CHECK ("max_attempts" BETWEEN 3 AND 5 AND "attempt_count" >= 0 AND "attempt_count" <= "max_attempts"),
    CONSTRAINT "chk_auth_oauth_transactions_terminal_state"
      CHECK (NOT ("consumed_at" IS NOT NULL AND "failed_at" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_auth_oauth_transactions_state_hash"
    ON "auth"."oauth_transactions" ("state_hash");
CREATE INDEX IF NOT EXISTS "idx_auth_oauth_transactions_expiry"
    ON "auth"."oauth_transactions" ("expires_at");
