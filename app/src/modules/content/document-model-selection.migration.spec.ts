import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { DataSource } from 'typeorm';

import { runDown, runUp } from '../../database/migrate';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../test-support/test-db';
import type { CreateUploadUrlCommand } from './contracts/create-upload-url.command';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';

const MODEL_SELECTION_MIGRATION_VERSION = '1787803981000';
const MODEL_SELECTION_MIGRATION_FILE = '1787803981000_allow_custom_document_model_selection';
const PLATFORM_MODEL_ID = 'platform-default';
const DEFAULT_EXPRESSION = "'platform-default'::character varying";

interface PlatformModelColumn {
  readonly column_default: string | null;
  readonly is_nullable: 'YES' | 'NO';
}

describe('custom document model selection migration', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let repository: ContentRepository;

  beforeAll(async () => {
    db = await startTestDb();
    dataSource = await createTestDataSource(db.container);
    repository = new ContentRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await db?.stop();
  });

  function buildCommand(selection: CreateUploadUrlCommand['selection']): CreateUploadUrlCommand & {
    readonly estimatedCredits: number | null;
    readonly selectedModelLabel: string;
  } {
    return {
      originalName: 'lecture.pdf',
      sizeBytes: 1024,
      type: DocumentType.PDF,
      selection,
      estimatedCredits: selection.kind === 'PLAN' ? 10 : null,
      selectedModelLabel: selection.kind === 'PLAN' ? 'Platform model' : 'My model',
    };
  }

  async function platformModelColumn(): Promise<PlatformModelColumn> {
    const result = await db.client.query<PlatformModelColumn>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'course' AND table_name = 'documents' AND column_name = 'platform_model_id'`,
    );
    return result.rows[0];
  }

  async function insertCustomDocumentRow(): Promise<void> {
    await db.client.query(
      `INSERT INTO "course"."documents"
         ("owner_id", "type", "original_name", "storage_ref", "size_bytes",
          "model_selection_kind", "platform_model_id", "custom_model_config_id")
       VALUES ($1, 'PDF', 'raw.pdf', $2, 1, 'CUSTOM', NULL, $3)`,
      [randomUUID(), `raw/${randomUUID()}`, randomUUID()],
    );
  }

  /** Reverts newer migrations too, so the test survives later migrations. */
  async function rollBackModelSelectionMigration(): Promise<void> {
    for (;;) {
      const latest = await db.client.query<{ readonly version: string }>(
        'SELECT "version" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1',
      );
      if (latest.rows[0].version < MODEL_SELECTION_MIGRATION_VERSION) return;
      await runDown(db.client);
    }
  }

  it('makes platform_model_id nullable and keeps the PLAN default', async () => {
    expect(await platformModelColumn()).toEqual({ is_nullable: 'YES', column_default: DEFAULT_EXPRESSION });
  });

  it('persists PLAN and CUSTOM documents through the real repository', async () => {
    const ownerId = randomUUID();
    const customModelConfigId = randomUUID();

    const planDocument = await repository.createUploaded(
      ownerId,
      buildCommand({ kind: 'PLAN', platformModelId: PLATFORM_MODEL_ID, customModelConfigId: null }),
      `${ownerId}/plan.pdf`,
    );
    const customDocument = await repository.createUploaded(
      ownerId,
      buildCommand({ kind: 'CUSTOM', platformModelId: null, customModelConfigId }),
      `${ownerId}/custom.pdf`,
    );

    const reloadedPlan = await repository.findByOwnerId(ownerId, planDocument.id);
    const reloadedCustom = await repository.findByOwnerId(ownerId, customDocument.id);
    expect(reloadedPlan).toMatchObject({
      modelSelectionKind: 'PLAN',
      platformModelId: PLATFORM_MODEL_ID,
      customModelConfigId: null,
      budgetStatus: 'NOT_RESERVED',
    });
    expect(reloadedCustom).toMatchObject({
      modelSelectionKind: 'CUSTOM',
      platformModelId: null,
      customModelConfigId,
      budgetStatus: 'CUSTOM_ZERO_COST',
    });
  });

  it('keeps chk_documents_model_selection fail-closed for invalid combinations', async () => {
    const ownerId = randomUUID();

    await expect(repository.createUploaded(
      ownerId,
      buildCommand({ kind: 'PLAN', platformModelId: null, customModelConfigId: null }),
      `${ownerId}/plan-without-model.pdf`,
    )).rejects.toThrow('chk_documents_model_selection');
    await expect(repository.createUploaded(
      ownerId,
      buildCommand({ kind: 'CUSTOM', platformModelId: PLATFORM_MODEL_ID, customModelConfigId: randomUUID() }),
      `${ownerId}/custom-with-platform-model.pdf`,
    )).rejects.toThrow('chk_documents_model_selection');
  });

  it('refuses rollback while CUSTOM documents exist, then rolls back and re-applies cleanly', async () => {
    await db.client.query(`DELETE FROM "course"."documents" WHERE "model_selection_kind" = 'CUSTOM'`);
    await insertCustomDocumentRow();

    await expect(rollBackModelSelectionMigration()).rejects.toThrow(
      'Cannot revert custom document model selection while CUSTOM documents exist',
    );
    expect(await platformModelColumn()).toEqual({ is_nullable: 'YES', column_default: DEFAULT_EXPRESSION });

    await db.client.query(`DELETE FROM "course"."documents" WHERE "model_selection_kind" = 'CUSTOM'`);
    await rollBackModelSelectionMigration();

    expect(await platformModelColumn()).toEqual({ is_nullable: 'NO', column_default: DEFAULT_EXPRESSION });
    await expect(insertCustomDocumentRow()).rejects.toThrow('platform_model_id');

    await runUp(db.client);

    expect(await platformModelColumn()).toEqual({ is_nullable: 'YES', column_default: DEFAULT_EXPRESSION });
    await expect(insertCustomDocumentRow()).resolves.toBeUndefined();
  });

  it('is idempotent when the up script runs again', async () => {
    const sql = readFileSync(
      join(__dirname, `../../database/migrations/${MODEL_SELECTION_MIGRATION_FILE}.up.sql`),
      'utf8',
    );

    await expect(db.client.query(sql)).resolves.toBeDefined();
    expect(await platformModelColumn()).toEqual({ is_nullable: 'YES', column_default: DEFAULT_EXPRESSION });
  });
});
