-- A single FULL_PIPELINE job is reused across probe generations. Receipts are
-- generation-scoped, so the job-level unique index would reject a valid retry.
DROP INDEX IF EXISTS "course"."uq_document_probe_receipt_job";
