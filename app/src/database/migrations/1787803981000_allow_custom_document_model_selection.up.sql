-- CUSTOM documents carry custom_model_config_id and no platform model
-- (chk_documents_model_selection, ADR-0021). The original column was NOT NULL,
-- so no CUSTOM row could ever be stored. Expand-only: the 'platform-default'
-- default stays so PLAN writers that omit the column (older runtimes, fixtures)
-- keep working, and CUSTOM writers send an explicit NULL. The check constraint
-- still rejects any PLAN/CUSTOM row with the wrong combination.
ALTER TABLE "course"."documents"
  ALTER COLUMN "platform_model_id" DROP NOT NULL;
