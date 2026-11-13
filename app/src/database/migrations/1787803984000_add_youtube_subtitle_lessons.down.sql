DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "course"."documents" WHERE "type" = 'YOUTUBE'
  ) THEN
    RAISE EXCEPTION 'Cannot revert YouTube subtitle lessons while YOUTUBE documents exist';
  END IF;
END
$$;

DROP TABLE IF EXISTS "course"."document_subtitle_transcripts";

ALTER TABLE "course"."documents" DROP CONSTRAINT IF EXISTS "chk_documents_youtube_video_id";
ALTER TABLE "course"."documents" DROP COLUMN IF EXISTS "youtube_video_id";
