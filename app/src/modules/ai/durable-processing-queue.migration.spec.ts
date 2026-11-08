import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { startTestDb, type TestDb } from '../../test-support/test-db';

describe('durable processing queue migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  it('keeps lease, retry, and DLQ state', async () => {
    expect(await columnNames()).toEqual(expect.arrayContaining([
      'completed_at',
      'cancellation_marker_id',
      'cancellation_reason',
      'cancelled_at',
      'failure_code',
      'lease_id',
      'lease_until',
      'next_visible_at',
      'technical_retry_count',
    ]));
    expect(await tableName('ai.processing_job_dlq')).toBe('ai.processing_job_dlq');
    expect(await tableName('ai.account_access_revocations')).toBe('ai.account_access_revocations');
  });

  it('keeps cancellation markers idempotent and separate from auth identity', async () => {
    const indexes = await db.client.query<{ readonly indexName: string }>(
      `SELECT indexname AS "indexName"
       FROM pg_indexes
       WHERE schemaname = 'ai' AND tablename = 'account_access_revocations'`,
    );
    expect(indexes.rows.map((row) => row.indexName)).toEqual(expect.arrayContaining([
      'uq_ai_account_access_revocations_event_key',
      'idx_ai_account_access_revocations_user_time',
    ]));

    const foreignKeys = await db.client.query<{ readonly constraintName: string }>(
      `SELECT constraint_name AS "constraintName"
       FROM information_schema.table_constraints
       WHERE table_schema = 'ai'
         AND table_name = 'account_access_revocations'
         AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(foreignKeys.rows).toHaveLength(0);

    const statusConstraint = await db.client.query<{ readonly definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'chk_ai_processing_jobs_status'`,
    );
    expect(statusConstraint.rows[0]?.definition).toContain('CANCELLED');
  });

  it('keeps media probe jobs separate from the FULL_PIPELINE queue', async () => {
    const indexes = await db.client.query<{ readonly indexName: string; readonly indexDefinition: string }>(
      `SELECT indexname AS "indexName", indexdef AS "indexDefinition"
       FROM pg_indexes
       WHERE schemaname = 'ai' AND tablename IN ('processing_jobs', 'media_probe_jobs')`,
    );
    const byName = new Map(indexes.rows.map((row) => [row.indexName, row.indexDefinition]));

    expect(byName.has('uq_job_document_type')).toBe(false);
    expect(byName.get('uq_processing_jobs_full_pipeline_document')).toContain(`WHERE ((job_type)::text = 'FULL_PIPELINE'::text)`);
    expect(byName.get('uq_media_probe_job_generation')).toContain('document_id');
    expect(await tableName('ai.media_probe_jobs')).toBe('ai.media_probe_jobs');
    expect(await tableName('ai.media_probe_results')).toBe('ai.media_probe_results');
    expect(await tableName('ai.media_probe_cancellation_tombstones')).toBe('ai.media_probe_cancellation_tombstones');
    expect(await tableName('course.document_probe_receipts')).toBe('course.document_probe_receipts');

    const mediaProbeForeignKey = await db.client.query<{ readonly definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'fk_media_probe_jobs_document'`,
    );
    expect(mediaProbeForeignKey.rows).toHaveLength(1);
    expect(mediaProbeForeignKey.rows[0]?.definition).toContain('course.documents');

    const purgeForeignKeys = await db.client.query<{
      readonly constraintName: string;
      readonly deleteAction: string;
    }>(
      `SELECT conname AS "constraintName", confdeltype AS "deleteAction"
       FROM pg_constraint
       WHERE conname IN (
         'fk_media_probe_results_job',
         'fk_processing_jobs_probe_result',
         'fk_document_probe_receipts_document'
       )
       ORDER BY conname`,
    );
    expect(purgeForeignKeys.rows).toEqual([
      { constraintName: 'fk_document_probe_receipts_document', deleteAction: 'c' },
      { constraintName: 'fk_media_probe_results_job', deleteAction: 'c' },
      { constraintName: 'fk_processing_jobs_probe_result', deleteAction: 'c' },
    ]);

    const processingProbeForeignKey = await db.client.query<{
      readonly definition: string;
      readonly deleteAction: string;
    }>(
      `SELECT pg_get_constraintdef(oid) AS definition, confdeltype AS "deleteAction"
       FROM pg_constraint
       WHERE conname = 'fk_processing_jobs_probe_result'`,
    );
    const processingProbeDefinition = processingProbeForeignKey.rows[0]?.definition
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(processingProbeDefinition).toContain(
      'FOREIGN KEY (probe_result_id, document_id, owner_id) REFERENCES ai.media_probe_results(id, document_id, owner_id)',
    );
    expect(processingProbeForeignKey.rows[0]?.deleteAction).toBe('c');

    const mediaProbeResultIndexes = await db.client.query<{ readonly indexName: string }>(
      `SELECT indexname AS "indexName"
       FROM pg_indexes
       WHERE schemaname = 'ai'
         AND tablename = 'media_probe_results'`,
    );
    expect(mediaProbeResultIndexes.rows.map((row) => row.indexName)).toContain(
      'uq_media_probe_result_document_owner',
    );

    const receiptIndexes = await db.client.query<{ readonly indexName: string }>(
      `SELECT indexname AS "indexName"
       FROM pg_indexes
       WHERE schemaname = 'course' AND tablename = 'document_probe_receipts'`,
    );
    expect(receiptIndexes.rows.map((row) => row.indexName)).toEqual(expect.arrayContaining([
      'uq_document_probe_receipt_generation',
    ]));
    expect(receiptIndexes.rows.map((row) => row.indexName)).not.toContain(
      'uq_document_probe_receipt_job',
    );

    const processingColumns = await columnNames();
    expect(processingColumns).toContain('probe_result_id');
    expect(processingColumns).not.toContain('source_version_id');
  });

  it('grants only the locator write and cancellation read columns needed by media-probe', async () => {
    const privileges = await db.client.query<{ readonly columnName: string }>(
      `SELECT column_name AS "columnName"
       FROM information_schema.column_privileges
       WHERE table_schema = 'ai'
         AND table_name = 'media_probe_jobs'
         AND grantee = 'learning_platform_media_probe'
         AND privilege_type = 'UPDATE'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [['source_version_id', 'source_etag', 'source_content_length']],
    );

    expect(privileges.rows).toEqual([
      { columnName: 'source_content_length' },
      { columnName: 'source_etag' },
      { columnName: 'source_version_id' },
    ]);

    const cancellationReadPrivileges = await db.client.query<{ readonly columnName: string }>(
      `SELECT column_name AS "columnName"
       FROM information_schema.column_privileges
       WHERE table_schema = 'ai'
         AND table_name = 'media_probe_cancellation_tombstones'
         AND grantee = 'learning_platform_media_probe'
         AND privilege_type = 'SELECT'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [['document_id', 'owner_id', 'deletion_fence']],
    );
    expect(cancellationReadPrivileges.rows).toEqual([
      { columnName: 'deletion_fence' },
      { columnName: 'document_id' },
      { columnName: 'owner_id' },
    ]);

    const mediaProbeJobPrivileges = await db.client.query<{
      readonly privilegeType: string;
      readonly columnName: string;
    }>(
      `SELECT privilege_type AS "privilegeType", column_name AS "columnName"
       FROM information_schema.column_privileges
       WHERE table_schema = 'ai'
         AND table_name = 'media_probe_jobs'
         AND grantee = 'learning_platform_media_probe'
         AND privilege_type IN ('SELECT', 'UPDATE')
         AND column_name = ANY($1::text[])
       ORDER BY privilege_type, column_name`,
      [['id', 'status', 'attempts', 'lease_id', 'lease_until', 'source_version_id', 'source_etag', 'source_content_length']],
    );
    expect(mediaProbeJobPrivileges.rows).toEqual([
      { privilegeType: 'SELECT', columnName: 'attempts' },
      { privilegeType: 'SELECT', columnName: 'id' },
      { privilegeType: 'SELECT', columnName: 'lease_id' },
      { privilegeType: 'SELECT', columnName: 'lease_until' },
      { privilegeType: 'SELECT', columnName: 'source_content_length' },
      { privilegeType: 'SELECT', columnName: 'source_etag' },
      { privilegeType: 'SELECT', columnName: 'source_version_id' },
      { privilegeType: 'SELECT', columnName: 'status' },
      { privilegeType: 'UPDATE', columnName: 'attempts' },
      { privilegeType: 'UPDATE', columnName: 'lease_id' },
      { privilegeType: 'UPDATE', columnName: 'lease_until' },
      { privilegeType: 'UPDATE', columnName: 'source_content_length' },
      { privilegeType: 'UPDATE', columnName: 'source_etag' },
      { privilegeType: 'UPDATE', columnName: 'source_version_id' },
      { privilegeType: 'UPDATE', columnName: 'status' },
    ]);

    const tombstoneReadPrivileges = await db.client.query<{ readonly columnName: string }>(
      `SELECT column_name AS "columnName"
       FROM information_schema.column_privileges
       WHERE table_schema = 'ai'
         AND table_name = 'media_probe_cancellation_tombstones'
         AND grantee = 'learning_platform_media_probe'
         AND privilege_type = 'SELECT'
       ORDER BY column_name`,
    );
    expect(tombstoneReadPrivileges.rows).toEqual([
      { columnName: 'deletion_fence' },
      { columnName: 'document_id' },
      { columnName: 'owner_id' },
    ]);
  });

  it('does not remove document probe state owned by the earlier migration on down', async () => {
    const rollbackDb = await startTestDb();
    try {
      // Rollback is strictly latest-first (see runDown in database/migrate.ts):
      // later migrations own objects that depend on ai.media_probe_jobs, so
      // their downs must run before this migration's down can drop the table.
      for (const name of [
        '1787803982000_add_media_stt_chunk_results',
        '1787803980000_add_media_audio_chunks',
        '1787803963000_add_media_probe_queue_contract',
      ]) {
        await rollbackDb.client.query(
          readFileSync(join(__dirname, `../../database/migrations/${name}.down.sql`), 'utf8'),
        );
      }

      const documentColumns = await rollbackDb.client.query<{ readonly column_name: string }>(
        `SELECT "column_name"
         FROM "information_schema"."columns"
         WHERE "table_schema" = 'course' AND "table_name" = 'documents'`,
      );
      expect(documentColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
        'deletion_fence',
        'probe_generation',
        'probe_policy_version',
      ]));

      const processingColumns = await rollbackDb.client.query<{ readonly column_name: string }>(
        `SELECT "column_name"
         FROM "information_schema"."columns"
         WHERE "table_schema" = 'ai' AND "table_name" = 'processing_jobs'`,
      );
      expect(processingColumns.rows.map((row) => row.column_name)).not.toEqual(expect.arrayContaining([
        'deletion_fence',
        'probe_generation',
        'policy_version',
        'probe_result_id',
      ]));

      const queueTables = await rollbackDb.client.query<{ readonly tableName: string | null }>(
        `SELECT to_regclass(value) AS "tableName"
         FROM unnest(ARRAY['ai.media_probe_jobs', 'ai.media_probe_results']) AS entry(value)`,
      );
      expect(queueTables.rows.every((row) => row.tableName === null)).toBe(true);

      const indexes = await rollbackDb.client.query<{ readonly indexName: string }>(
        `SELECT indexname AS "indexName"
         FROM pg_indexes
         WHERE schemaname = 'ai'
           AND indexname IN ('uq_job_document_type', 'uq_processing_jobs_full_pipeline_document')`,
      );
      expect(indexes.rows.map((row) => row.indexName)).toEqual(['uq_job_document_type']);
    } finally {
      await rollbackDb.stop();
    }
  });

  it('restores restrictive probe dependencies when the purge migration is reverted', async () => {
    const rollbackDb = await startTestDb();
    try {
      const downSql = readFileSync(
        join(__dirname, '../../database/migrations/1787803971000_align_media_probe_purge_dependencies.down.sql'),
        'utf8',
      );
      await rollbackDb.client.query(downSql);

      const constraints = await rollbackDb.client.query<{
        readonly constraintName: string;
        readonly deleteAction: string;
      }>(
        `SELECT conname AS "constraintName", confdeltype AS "deleteAction"
         FROM pg_constraint
         WHERE conname IN (
           'fk_media_probe_results_job',
           'fk_processing_jobs_probe_result',
           'fk_document_probe_receipts_document'
         )
         ORDER BY conname`,
      );
      expect(constraints.rows).toEqual([
        { constraintName: 'fk_media_probe_results_job', deleteAction: 'r' },
        { constraintName: 'fk_processing_jobs_probe_result', deleteAction: 'r' },
      ]);
    } finally {
      await rollbackDb.stop();
    }
  });

  it('restores the pre-scope single-column probe-result FK when the scope migration is reverted', async () => {
    const rollbackDb = await startTestDb();
    try {
      const downSql = readFileSync(
        join(__dirname, '../../database/migrations/1787803972000_scope_processing_probe_result_fk.down.sql'),
        'utf8',
      );
      await rollbackDb.client.query(downSql);

      const foreignKey = await rollbackDb.client.query<{
        readonly definition: string;
        readonly deleteAction: string;
      }>(
        `SELECT pg_get_constraintdef(oid) AS definition, confdeltype AS "deleteAction"
         FROM pg_constraint
         WHERE conname = 'fk_processing_jobs_probe_result'`,
      );
      const definition = foreignKey.rows[0]?.definition
        .replace(/"/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      expect(definition).toContain(
        'FOREIGN KEY (probe_result_id) REFERENCES ai.media_probe_results(id)',
      );
      expect(foreignKey.rows[0]?.deleteAction).toBe('c');

      const scopedIndex = await rollbackDb.client.query<{ readonly indexName: string }>(
        `SELECT indexname AS "indexName"
         FROM pg_indexes
         WHERE schemaname = 'ai'
           AND indexname = 'uq_media_probe_result_document_owner'`,
      );
      expect(scopedIndex.rows).toHaveLength(0);
    } finally {
      await rollbackDb.stop();
    }
  });

  it('preserves established probe grants when the grant-repair migration is reverted', async () => {
    const rollbackDb = await startTestDb();
    try {
      const downSql = readFileSync(
        join(__dirname, '../../database/migrations/1787803978000_reapply_media_probe_worker_grants.down.sql'),
        'utf8',
      );
      await rollbackDb.client.query(downSql);

      const grants = await rollbackDb.client.query<{ readonly tableName: string; readonly columnName: string; readonly privilegeType: string }>(
        `SELECT table_name AS "tableName", column_name AS "columnName", privilege_type AS "privilegeType"
         FROM information_schema.column_privileges
         WHERE table_schema = 'ai'
           AND grantee = 'learning_platform_media_probe'
           AND ((table_name = 'media_probe_jobs' AND column_name IN ('source_version_id', 'source_etag', 'source_content_length') AND privilege_type = 'UPDATE')
             OR (table_name = 'media_probe_cancellation_tombstones' AND column_name IN ('document_id', 'owner_id', 'deletion_fence') AND privilege_type = 'SELECT'))
         ORDER BY table_name, column_name, privilege_type`,
      );
      expect(grants.rows).toEqual([
        { tableName: 'media_probe_cancellation_tombstones', columnName: 'deletion_fence', privilegeType: 'SELECT' },
        { tableName: 'media_probe_cancellation_tombstones', columnName: 'document_id', privilegeType: 'SELECT' },
        { tableName: 'media_probe_cancellation_tombstones', columnName: 'owner_id', privilegeType: 'SELECT' },
        { tableName: 'media_probe_jobs', columnName: 'source_content_length', privilegeType: 'UPDATE' },
        { tableName: 'media_probe_jobs', columnName: 'source_etag', privilegeType: 'UPDATE' },
        { tableName: 'media_probe_jobs', columnName: 'source_version_id', privilegeType: 'UPDATE' },
      ]);
    } finally {
      await rollbackDb.stop();
    }
  });

  it('stores media STT checkpoints that cascade with the probe result and stay unique per provider identity', async () => {
    const columns = await db.client.query<{ readonly columnName: string }>(
      `SELECT "column_name" AS "columnName" FROM "information_schema"."columns"
       WHERE "table_schema" = 'ai' AND "table_name" = 'media_stt_chunk_results'`,
    );
    expect(columns.rows.map((row) => row.columnName)).toEqual(expect.arrayContaining([
      'probe_result_id', 'chunk_index', 'stt_provider_identity', 'segments', 'billed_ms', 'uncertain_ms',
    ]));
    const cascade = await db.client.query<{ readonly deleteAction: string }>(
      `SELECT confdeltype AS "deleteAction" FROM pg_constraint
       WHERE conname = 'fk_media_stt_chunk_results_probe_result'`,
    );
    expect(cascade.rows).toEqual([{ deleteAction: 'c' }]);
    const unique = await db.client.query<{ readonly indexName: string }>(
      `SELECT indexname AS "indexName" FROM pg_indexes
       WHERE schemaname = 'ai' AND tablename = 'media_stt_chunk_results'
         AND indexdef LIKE 'CREATE UNIQUE%'
         AND indexdef LIKE '%(probe_result_id, chunk_index, stt_provider_identity)%'`,
    );
    expect(unique.rows).toHaveLength(1);
  });

  describe('media probe database role least privilege (#164)', () => {
    const MEDIA_PROBE_ROLE = 'learning_platform_media_probe';
    const FORBIDDEN_TABLES = [
      'course.documents',
      'course.owner_credit_wallets',
      'course.credit_ledger_entries',
      'ai.processing_jobs',
    ] as const;
    // Column-level allowlist: the Go media probe worker may only touch these ai.* columns.
    const EXPECTED_COLUMN_GRANTS: readonly string[] = [
      'ai.media_audio_chunks|INSERT|body_end_ms,body_start_ms,bucket,chunk_index,content_length,deletion_fence,document_id,etag,file_end_ms,file_start_ms,media_probe_job_id,object_key,owner_id,probe_generation,sha256,version_id',
      'ai.media_audio_chunks|SELECT|body_end_ms,body_start_ms,bucket,chunk_index,content_length,created_at,deletion_fence,document_id,etag,file_end_ms,file_start_ms,id,media_probe_job_id,object_key,owner_id,probe_generation,sha256,version_id',
      'ai.media_probe_cancellation_tombstones|SELECT|deletion_fence,document_id,owner_id',
      'ai.media_probe_jobs|SELECT|attempts,completed_at,correlation_id,created_at,deletion_fence,document_id,error_message,failure_code,full_pipeline_job_id,id,lease_id,lease_until,next_visible_at,owner_id,policy_version,probe_generation,probe_result_id,source_bucket,source_content_length,source_etag,source_key,source_version_id,status,technical_retry_count,updated_at',
      'ai.media_probe_jobs|UPDATE|attempts,completed_at,error_message,failure_code,lease_id,lease_until,next_visible_at,probe_result_id,source_content_length,source_etag,source_version_id,status,technical_retry_count,updated_at',
      'ai.media_probe_results|INSERT|bucket,content_length,decoded_duration_ms,deletion_fence,document_id,duration_sec,etag,full_pipeline_job_id,media_probe_job_id,object_key,owner_id,policy_version,probe_generation,version_id',
      'ai.media_probe_results|SELECT|bucket,content_length,created_at,decoded_duration_ms,deletion_fence,document_id,duration_sec,etag,full_pipeline_job_id,id,media_probe_job_id,object_key,owner_id,policy_version,probe_generation,version_id',
      'ai.outbox|INSERT|aggregate_id,event_type,payload',
      'ai.outbox|SELECT|aggregate_id,event_type',
    ];

    async function expectPermissionDenied(statement: string): Promise<void> {
      await db.client.query(`SET ROLE ${MEDIA_PROBE_ROLE}`);
      try {
        await expect(db.client.query(statement)).rejects.toThrow(/permission denied/);
      } finally {
        await db.client.query('RESET ROLE');
      }
    }

    it.each(FORBIDDEN_TABLES)('denies SELECT and UPDATE on %s to the media probe role', async (table) => {
      await expectPermissionDenied(`SELECT 1 FROM ${table} LIMIT 1`);
      await expectPermissionDenied(`UPDATE ${table} SET updated_at = now()`);
    });

    it.each(FORBIDDEN_TABLES)('has no table or column privilege on %s for the media probe role', async (table) => {
      const privileges = await db.client.query<{ readonly hasPrivilege: boolean }>(
        `SELECT bool_or(has_table_privilege($1, $2, privilege)) OR
                bool_or(privilege <> 'DELETE' AND has_any_column_privilege($1, $2, privilege)) AS "hasPrivilege"
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES']) AS privilege`,
        [MEDIA_PROBE_ROLE, table],
      );
      expect(privileges.rows[0]?.hasPrivilege).toBe(false);
    });

    it('grants the media probe role no table-level privilege and only the allowlisted column privileges', async () => {
      const tableGrants = await db.client.query<{ readonly grant: string }>(
        `SELECT table_schema || '.' || table_name || '|' || privilege_type AS "grant"
         FROM information_schema.role_table_grants
         WHERE grantee = $1 ORDER BY 1`,
        [MEDIA_PROBE_ROLE],
      );
      expect(tableGrants.rows).toEqual([]);
      const aclGrants = await db.client.query<{ readonly relation: string }>(
        `SELECT n.nspname || '.' || c.relname || '|' || c.relkind::text AS "relation"
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
         WHERE acl.grantee = $1::regrole::oid
         ORDER BY 1`,
        [MEDIA_PROBE_ROLE],
      );
      // Only the outbox id sequence (relkind S) may carry a relation-level ACL entry for this role.
      expect(aclGrants.rows.map((row) => row.relation)).toEqual(['ai.outbox_id_seq|S']);

      const columnGrants = await db.client.query<{ readonly grant: string }>(
        `SELECT table_schema || '.' || table_name || '|' || privilege_type || '|' ||
                string_agg(column_name, ',' ORDER BY column_name) AS "grant"
         FROM information_schema.column_privileges
         WHERE grantee = $1 AND table_schema NOT IN ('information_schema', 'pg_catalog')
         GROUP BY table_schema, table_name, privilege_type
         ORDER BY 1`,
        [MEDIA_PROBE_ROLE],
      );
      expect(columnGrants.rows.map((row) => row.grant)).toEqual([...EXPECTED_COLUMN_GRANTS].sort());
    });
  });

  async function columnNames(): Promise<string[]> {
    const result = await db.client.query<{ readonly column_name: string }>(
      `SELECT "column_name" FROM "information_schema"."columns"
       WHERE "table_schema" = 'ai' AND "table_name" = 'processing_jobs'`,
    );
    return result.rows.map((row) => row.column_name);
  }

  async function tableName(qualifiedName: string): Promise<string | null> {
    const result = await db.client.query<{ readonly tableName: string | null }>(
      'SELECT to_regclass($1) AS "tableName"',
      [qualifiedName],
    );
    return result.rows[0]?.tableName ?? null;
  }
});
