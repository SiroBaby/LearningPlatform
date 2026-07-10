-- Migration: 1717700000000_create_documents (down)
-- Pure SQL. IF EXISTS.

DROP INDEX IF EXISTS "idx_doc_status";
DROP INDEX IF EXISTS "idx_doc_owner";
DROP TABLE IF EXISTS "documents";
