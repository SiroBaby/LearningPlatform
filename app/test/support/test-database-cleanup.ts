export const DOCUMENT_FLOW_CLEANUP_SQL =
  'TRUNCATE "auth"."outbox", "auth"."sessions", "auth"."user_profiles", "auth"."users", "quiz"."options", "quiz"."questions", "quiz"."quizzes", "ai"."generation_cache", "ai"."prompt_versions", "ai"."provider_usage_records", "ai"."processing_job_dlq", "ai"."account_access_revocations", "ai"."processing_jobs", "ai"."chunks", "ai"."owner_model_configs", "course"."credit_ledger_entries", "course"."owner_credit_wallets", "course"."owner_entitlements", "course"."documents", "course"."outbox", "ai"."outbox" CASCADE';

type TestDatabaseClient = {
  query(sql: string): Promise<unknown>;
};

export async function clearDocumentFlowData(client: TestDatabaseClient): Promise<void> {
  await client.query(DOCUMENT_FLOW_CLEANUP_SQL);
}
