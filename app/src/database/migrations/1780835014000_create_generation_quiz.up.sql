CREATE TABLE IF NOT EXISTS "ai"."prompt_versions" (
    "fingerprint" varchar(64) PRIMARY KEY CHECK (length("fingerprint") = 64),
    "model"       varchar(255) NOT NULL CHECK (length(btrim("model")) > 0),
    "parameters"  jsonb NOT NULL,
    "template"    text NOT NULL CHECK (length(btrim("template")) > 0),
    "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ai"."generation_cache" (
    "cache_key"          varchar(64) PRIMARY KEY CHECK (length("cache_key") = 64),
    "model"              varchar(255) NOT NULL CHECK (length(btrim("model")) > 0),
    "prompt_fingerprint" varchar(64) NOT NULL CHECK (length("prompt_fingerprint") = 64),
    "parameters"         jsonb NOT NULL,
    "output"             jsonb NOT NULL,
    "created_at"         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_generation_cache_prompt_fingerprint"
    ON "ai"."generation_cache" ("prompt_fingerprint");

CREATE TABLE IF NOT EXISTS "quiz"."quizzes" (
    "id"              uuid PRIMARY KEY,
    "document_id"     uuid NOT NULL,
    "owner_id"        uuid NOT NULL,
    "prompt_version"  varchar(128) NOT NULL CHECK (length(btrim("prompt_version")) > 0),
    "idempotency_key" varchar(64) NOT NULL CHECK (length("idempotency_key") = 64),
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_quizzes_idempotency_key"
    ON "quiz"."quizzes" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_quizzes_owner_document"
    ON "quiz"."quizzes" ("owner_id", "document_id");

CREATE TABLE IF NOT EXISTS "quiz"."questions" (
    "id"              uuid PRIMARY KEY,
    "quiz_id"         uuid NOT NULL REFERENCES "quiz"."quizzes" ("id") ON DELETE CASCADE,
    "owner_id"        uuid NOT NULL,
    "chunk_id"        uuid NOT NULL,
    "chunk_index"     integer NOT NULL CHECK ("chunk_index" >= 0),
    "ordinal"         integer NOT NULL CHECK ("ordinal" >= 0),
    "stem"            text NOT NULL CHECK (length(btrim("stem")) > 0),
    "explanation"     text NOT NULL CHECK (length(btrim("explanation")) > 0),
    "citation_ref"    jsonb NOT NULL CHECK (
        jsonb_typeof("citation_ref") = 'object'
        AND length(btrim("citation_ref" ->> 'chunkId')) > 0
        AND length(btrim("citation_ref" ->> 'snippet')) > 0
        AND "citation_ref" ? 'locator'
        AND "citation_ref" ->> 'chunkId' = "chunk_id"::text
    ),
    "idempotency_key" varchar(64) NOT NULL CHECK (length("idempotency_key") = 64),
    "created_at"      timestamptz NOT NULL DEFAULT now(),
    "updated_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_questions_idempotency_key"
    ON "quiz"."questions" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_questions_quiz_chunk_ordinal"
    ON "quiz"."questions" ("quiz_id", "chunk_id", "ordinal");
CREATE INDEX IF NOT EXISTS "idx_questions_owner_quiz"
    ON "quiz"."questions" ("owner_id", "quiz_id", "ordinal");

CREATE TABLE IF NOT EXISTS "quiz"."options" (
    "id"           uuid PRIMARY KEY,
    "question_id"  uuid NOT NULL REFERENCES "quiz"."questions" ("id") ON DELETE CASCADE,
    "owner_id"     uuid NOT NULL,
    "option_index" integer NOT NULL CHECK ("option_index" >= 0),
    "content"      text NOT NULL CHECK (length(btrim("content")) > 0),
    "is_correct"   boolean NOT NULL,
    "created_at"   timestamptz NOT NULL DEFAULT now(),
    "updated_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_options_question_index"
    ON "quiz"."options" ("question_id", "option_index");
CREATE INDEX IF NOT EXISTS "idx_options_owner_question"
    ON "quiz"."options" ("owner_id", "question_id");
