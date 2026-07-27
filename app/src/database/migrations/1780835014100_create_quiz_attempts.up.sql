CREATE TABLE IF NOT EXISTS "quiz"."attempts" (
    "id"             uuid PRIMARY KEY,
    "quiz_id"        uuid NOT NULL REFERENCES "quiz"."quizzes" ("id") ON DELETE CASCADE,
    "owner_id"       uuid NOT NULL,
    "score"          integer NOT NULL CHECK ("score" >= 0),
    "question_count" integer NOT NULL CHECK ("question_count" > 0 AND "score" <= "question_count"),
    "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_attempts_owner_quiz_created_at"
    ON "quiz"."attempts" ("owner_id", "quiz_id", "created_at");

CREATE TABLE IF NOT EXISTS "quiz"."attempt_answers" (
    "attempt_id"        uuid NOT NULL REFERENCES "quiz"."attempts" ("id") ON DELETE CASCADE,
    "question_id"       uuid NOT NULL REFERENCES "quiz"."questions" ("id"),
    "selected_option_id" uuid NOT NULL REFERENCES "quiz"."options" ("id"),
    "owner_id"          uuid NOT NULL,
    "is_correct"        boolean NOT NULL,
    PRIMARY KEY ("attempt_id", "question_id")
);

CREATE INDEX IF NOT EXISTS "idx_attempt_answers_owner_attempt"
    ON "quiz"."attempt_answers" ("owner_id", "attempt_id");
