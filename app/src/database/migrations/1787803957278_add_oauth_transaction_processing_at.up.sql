-- Migration: 1787803957278_add_oauth_transaction_processing_at (up)
-- Reserve marker used by atomic OAuth callback attempts.
ALTER TABLE "auth"."oauth_transactions"
  ADD COLUMN IF NOT EXISTS "processing_at" timestamptz;
