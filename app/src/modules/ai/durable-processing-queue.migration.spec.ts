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

  it('does not grant media-probe UPDATE access to immutable source locator columns', async () => {
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

    expect(privileges.rows).toEqual([]);
  });

  it('does not remove document probe state owned by the earlier migration on down', async () => {
    const rollbackDb = await startTestDb();
    try {
      const downSql = readFileSync(
        join(__dirname, '../../database/migrations/1787803963000_add_media_probe_queue_contract.down.sql'),
        'utf8',
      );
      await rollbackDb.client.query(downSql);

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
