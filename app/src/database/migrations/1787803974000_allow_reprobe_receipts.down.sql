CREATE UNIQUE INDEX IF NOT EXISTS "uq_document_probe_receipt_job"
  ON "course"."document_probe_receipts" ("full_pipeline_job_id");
