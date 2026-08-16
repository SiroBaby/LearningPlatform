-- ADR-0023: Go worker may retrieve only the source descriptor it needs.
-- The deployment provisions a LOGIN principal that is a member of this NOLOGIN role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_worker') THEN
    CREATE ROLE ai_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

REVOKE ALL ON SCHEMA "course" FROM ai_worker;
REVOKE ALL ON TABLE "course"."documents" FROM ai_worker;
REVOKE ALL ON TABLE "course"."outbox" FROM ai_worker;
GRANT USAGE ON SCHEMA "course" TO ai_worker;
GRANT SELECT ("id", "owner_id", "type", "storage_ref", "size_bytes", "status")
  ON TABLE "course"."documents" TO ai_worker;

GRANT USAGE ON SCHEMA "ai" TO ai_worker;
GRANT SELECT, UPDATE ON TABLE "ai"."processing_jobs" TO ai_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ai"."chunks" TO ai_worker;
GRANT INSERT ON TABLE "ai"."processing_job_dlq" TO ai_worker;
GRANT INSERT ON TABLE "ai"."outbox" TO ai_worker;
GRANT USAGE ON SEQUENCE "ai"."outbox_id_seq" TO ai_worker;
