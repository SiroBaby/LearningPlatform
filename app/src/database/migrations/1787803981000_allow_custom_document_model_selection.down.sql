DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "course"."documents" WHERE "model_selection_kind" = 'CUSTOM'
  ) THEN
    RAISE EXCEPTION 'Cannot revert custom document model selection while CUSTOM documents exist';
  END IF;
END
$$;

ALTER TABLE "course"."documents"
  ALTER COLUMN "platform_model_id" SET NOT NULL;
