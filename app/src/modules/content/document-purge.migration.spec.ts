import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, type TestDb } from '../../test-support/test-db';

const PURGE_LEASE_MIGRATION_VERSION = '1787803979000';

describe('document purge lease and dead-letter migration', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });

  async function purgeColumns(): Promise<string[]> {
    const result = await db.client.query<{ readonly column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'course' AND table_name = 'document_purge_manifests'
          AND column_name IN ('lease_id', 'lease_until', 'dead_lettered_at')
        ORDER BY column_name`,
    );
    return result.rows.map((row) => row.column_name);
  }

  async function insertManifest(status: string, extra: string = '', extraValues: unknown[] = []): Promise<string> {
    const documentId = randomUUID();
    const result = await db.client.query<{ readonly id: string }>(
      `INSERT INTO "course"."document_purge_manifests"
         ("document_id", "owner_id", "deletion_fence", "idempotency_key", "status"${extra ? `, ${extra}` : ''})
       VALUES ($1, $2, 1, $3, $4${extraValues.map((_value, index) => `, $${index + 5}`).join('')})
       RETURNING "id"`,
      [documentId, randomUUID(), `document-purge:${documentId}:1`, status, ...extraValues],
    );
    return result.rows[0].id;
  }

  /** Reverts newer migrations too, so the test survives later migrations. */
  async function rollBackPurgeLeaseMigration(): Promise<void> {
    for (;;) {
      const latest = await db.client.query<{ readonly version: string }>(
        'SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1',
      );
      if (latest.rows[0].version < PURGE_LEASE_MIGRATION_VERSION) return;
      await runDown(db.client);
    }
  }

  it('adds the lease columns, DEAD_LETTER status and reclaim index', async () => {
    expect(await purgeColumns()).toEqual(['dead_lettered_at', 'lease_id', 'lease_until']);
    const index = await db.client.query<{ readonly indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'course' AND indexname = 'idx_document_purge_manifest_reclaimable'`,
    );
    expect(index.rows[0]?.indexdef).toContain(`WHERE ((status)::text = 'RUNNING'::text)`);
    await expect(insertManifest('DEAD_LETTER')).resolves.toEqual(expect.any(String));
    await expect(insertManifest('UNKNOWN')).rejects.toThrow('chk_document_purge_manifest_status');
  });

  it('refuses rollback while DEAD_LETTER rows exist, then rolls back and re-applies cleanly', async () => {
    await db.client.query('DELETE FROM "course"."document_purge_manifests"');
    const deadLetterId = await insertManifest('DEAD_LETTER');

    await expect(rollBackPurgeLeaseMigration()).rejects.toThrow(
      'document purge manifests in DEAD_LETTER must be resolved before rollback',
    );
    expect(await purgeColumns()).toEqual(['dead_lettered_at', 'lease_id', 'lease_until']);

    await db.client.query('DELETE FROM "course"."document_purge_manifests" WHERE "id" = $1', [deadLetterId]);
    const runningId = await insertManifest(
      'RUNNING',
      '"lease_id", "lease_until"',
      [randomUUID(), new Date(Date.now() + 60_000)],
    );

    await rollBackPurgeLeaseMigration();

    expect(await purgeColumns()).toEqual([]);
    const running = await db.client.query<{ readonly status: string }>(
      'SELECT "status" FROM "course"."document_purge_manifests" WHERE "id" = $1',
      [runningId],
    );
    expect(running.rows[0].status).toBe('PENDING');
    await expect(insertManifest('DEAD_LETTER')).rejects.toThrow('chk_document_purge_manifest_status');

    await runUp(db.client);
    expect(await purgeColumns()).toEqual(['dead_lettered_at', 'lease_id', 'lease_until']);
    await expect(insertManifest('DEAD_LETTER')).resolves.toEqual(expect.any(String));
  });

  it('is idempotent when the up script runs again', async () => {
    const sql = readFileSync(
      join(__dirname, '../../database/migrations/1787803979000_add_document_purge_lease_and_dead_letter.up.sql'),
      'utf8',
    );
    await expect(db.client.query(sql)).resolves.toBeDefined();
    expect(await purgeColumns()).toEqual(['dead_lettered_at', 'lease_id', 'lease_until']);
  });
});
