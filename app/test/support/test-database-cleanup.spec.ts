import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { JobType } from '../../src/modules/ai/enums/job-type.enum';
import { ProcessingJobRepository } from '../../src/modules/ai/repositories/processing-job.repository';
import { createTestDataSource } from '../../src/test-support/test-data-source';
import { startTestDb, type TestDb } from '../../src/test-support/test-db';
import {
  clearDocumentFlowData,
  DOCUMENT_FLOW_CLEANUP_SQL,
} from './test-database-cleanup';

describe('document flow database fixture', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let processingJobs: ProcessingJobRepository;

  beforeAll(async () => {
    db = await startTestDb();
    dataSource = await createTestDataSource(db.container);
    processingJobs = new ProcessingJobRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await db?.stop();
  });

  beforeEach(async () => {
    await clearDocumentFlowData(db.client);
  });

  it('clears billing rows from the canonical course schema', () => {
    expect(DOCUMENT_FLOW_CLEANUP_SQL).toContain('"course"."credit_ledger_entries"');
    expect(DOCUMENT_FLOW_CLEANUP_SQL).toContain('"course"."owner_credit_wallets"');
    expect(DOCUMENT_FLOW_CLEANUP_SQL).not.toContain('"ai"."credit_ledger_entries"');
    expect(DOCUMENT_FLOW_CLEANUP_SQL).not.toContain('"ai"."owner_credit_wallets"');
  });

  it('removes access-revocation markers so a fresh owner can enqueue', async () => {
    const ownerId = randomUUID();
    const documentId = randomUUID();
    await db.client.query(
      `INSERT INTO "ai"."account_access_revocations"
         ("user_id", "reason_code", "event_idempotency_key")
       VALUES ($1, 'ACCOUNT_SUSPENDED', $2)`,
      [ownerId, `${ownerId}:ACCOUNT_SUSPENDED`],
    );

    expect(await countRows('ai', 'account_access_revocations')).toBe(1);

    await clearDocumentFlowData(db.client);

    expect(await countRows('ai', 'account_access_revocations')).toBe(0);

    await processingJobs.enqueue(
      {
        correlationId: randomUUID(),
        documentId,
        jobType: JobType.FULL_PIPELINE,
        ownerId,
      },
      `${documentId}:FULL_PIPELINE`,
    );

    const jobs = await db.client.query(
      `SELECT "owner_id" AS "ownerId", "document_id" AS "documentId", "status"
       FROM "ai"."processing_jobs"
       WHERE "document_id" = $1`,
      [documentId],
    );
    expect(jobs.rows).toEqual([{
      documentId,
      ownerId,
      status: 'PENDING',
    }]);
  });

  async function countRows(schema: string, table: string): Promise<number> {
    const result = await db.client.query(`SELECT count(*)::int AS "count" FROM "${schema}"."${table}"`);
    return result.rows[0].count;
  }

});
