import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { runDown, runUp } from '../../database/migrate';
import { startTestDb, type TestDb } from '../../test-support/test-db';

const MIGRATION_VERSION = '1787803984000';
const MIGRATION_FILE = '1787803984000_add_youtube_subtitle_lessons';
const VIDEO_ID = 'dQw4w9WgXcQ';
const SHA256 = 'a'.repeat(64);

describe('YouTube subtitle lessons migration', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  async function insertDocument(type: string, youtubeVideoId: string | null): Promise<string> {
    const result = await db.client.query<{ id: string }>(
      `INSERT INTO "course"."documents" ("owner_id", "type", "original_name", "storage_ref", "size_bytes", "youtube_video_id")
       VALUES ($1, $2, 'x', $3, 1, $4) RETURNING "id"`,
      [randomUUID(), type, `k/${randomUUID()}`, youtubeVideoId],
    );
    return result.rows[0].id;
  }

  async function insertSnapshot(documentId: string, overrides: Record<string, unknown> = {}): Promise<void> {
    const row = {
      char_count: 5,
      cue_count: 1,
      cues: JSON.stringify([{ startMs: 0, endMs: 1000, text: 'xin chao' }]),
      duration_ms: 1000,
      source_format: 'VTT',
      source_sha256: SHA256,
      source_size_bytes: 10,
      ...overrides,
    };
    await db.client.query(
      `INSERT INTO "course"."document_subtitle_transcripts"
         ("document_id", "owner_id", "source_format", "source_sha256", "source_size_bytes", "parser_version",
          "cues", "cue_count", "char_count", "duration_ms")
       VALUES ($1, $2, $3, $4, $5, 'v1', $6::jsonb, $7, $8, $9)`,
      [documentId, randomUUID(), row.source_format, row.source_sha256, row.source_size_bytes, row.cues, row.cue_count, row.char_count, row.duration_ms],
    );
  }

  async function rollBackToBeforeMigration(): Promise<void> {
    for (;;) {
      const latest = await db.client.query<{ readonly version: string }>(
        'SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1',
      );
      if (latest.rows[0].version < MIGRATION_VERSION) return;
      await runDown(db.client);
    }
  }

  async function tableExists(): Promise<boolean> {
    const result = await db.client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'course' AND table_name = 'document_subtitle_transcripts'`,
    );
    return result.rowCount === 1;
  }

  it('accepts a YOUTUBE document only with a valid 11 character video id', async () => {
    await expect(insertDocument('YOUTUBE', VIDEO_ID)).resolves.toEqual(expect.any(String));
    await expect(insertDocument('YOUTUBE', null)).rejects.toThrow('chk_documents_youtube_video_id');
    await expect(insertDocument('YOUTUBE', 'short')).rejects.toThrow('chk_documents_youtube_video_id');
    await expect(insertDocument('YOUTUBE', 'bad id!!!!!')).rejects.toThrow('chk_documents_youtube_video_id');
  });

  it('keeps youtube_video_id null for every other type', async () => {
    await expect(insertDocument('PDF', null)).resolves.toEqual(expect.any(String));
    await expect(insertDocument('PDF', VIDEO_ID)).rejects.toThrow('chk_documents_youtube_video_id');
  });

  it('stores a snapshot and enforces its checks', async () => {
    const documentId = await insertDocument('YOUTUBE', VIDEO_ID);

    await expect(insertSnapshot(documentId)).resolves.toBeUndefined();
    await expect(insertSnapshot(documentId)).rejects.toThrow('document_subtitle_transcripts_pkey');
    const others = [
      ['source_format', { source_format: 'ASS' }],
      ['source_sha256', { source_sha256: 'XYZ' }],
      ['source_size_bytes', { source_size_bytes: 5 * 1024 * 1024 + 1 }],
      ['cue_count', { cue_count: 0, cues: '[]' }],
      ['chk_document_subtitle_cue_count', { cue_count: 2 }],
      ['char_count', { char_count: 500_001 }],
      ['duration_ms', { duration_ms: 0 }],
      ['non-array', { cues: '{}' }],
    ] as const;
    for (const [constraint, overrides] of others) {
      const other = await insertDocument('YOUTUBE', VIDEO_ID);
      await expect(insertSnapshot(other, overrides)).rejects.toThrow(constraint);
    }
  });

  it('cascades the snapshot with its Document', async () => {
    const documentId = await insertDocument('YOUTUBE', VIDEO_ID);
    await insertSnapshot(documentId);

    await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [documentId]);

    const remaining = await db.client.query('SELECT 1 FROM "course"."document_subtitle_transcripts" WHERE "document_id" = $1', [documentId]);
    expect(remaining.rowCount).toBe(0);
  });

  it('refuses rollback while YOUTUBE documents exist, then rolls back and re-applies cleanly', async () => {
    await db.client.query(`DELETE FROM "course"."documents" WHERE "type" = 'YOUTUBE'`);
    await insertDocument('YOUTUBE', VIDEO_ID);

    await expect(rollBackToBeforeMigration()).rejects.toThrow(
      'Cannot revert YouTube subtitle lessons while YOUTUBE documents exist',
    );
    expect(await tableExists()).toBe(true);

    await db.client.query(`DELETE FROM "course"."documents" WHERE "type" = 'YOUTUBE'`);
    await rollBackToBeforeMigration();
    expect(await tableExists()).toBe(false);
    await expect(db.client.query(`SELECT "youtube_video_id" FROM "course"."documents"`)).rejects.toThrow('youtube_video_id');

    await runUp(db.client);

    expect(await tableExists()).toBe(true);
  });

  it('is idempotent when the up script runs again', async () => {
    const sql = readFileSync(join(__dirname, `../../database/migrations/${MIGRATION_FILE}.up.sql`), 'utf8');

    await expect(db.client.query(sql)).resolves.toBeDefined();
    await expect(db.client.query(sql)).resolves.toBeDefined();
    expect(await tableExists()).toBe(true);
  });
});
