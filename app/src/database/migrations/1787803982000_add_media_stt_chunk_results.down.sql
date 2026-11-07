-- Rolling back drops stored transcripts and STT spend counters of jobs still in flight; those jobs
-- re-run speech-to-text on the next attempt. The derived-audio objects are untouched.
DROP TABLE IF EXISTS "ai"."media_stt_chunk_results";
