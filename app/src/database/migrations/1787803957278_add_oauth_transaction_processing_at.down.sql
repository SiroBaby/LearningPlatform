-- Migration: 1787803957278_add_oauth_transaction_processing_at (down)
ALTER TABLE "auth"."oauth_transactions"
  DROP COLUMN IF EXISTS "processing_at";
