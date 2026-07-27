import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { startTestDb, type TestDb } from '../../../test-support/test-db';
import { BudgetReservationRepository } from '../../content/repositories/budget-reservation.repository';
import { createTestDataSource } from '../../../test-support/test-data-source';

describe('BudgetReservationRepository', () => {
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });
  beforeEach(async () => {
    await db.client.query('TRUNCATE "course"."credit_ledger_entries", "course"."owner_credit_wallets"');
  });

  it('reserves once and releases unused credits idempotently', async () => {
    const ownerId = randomUUID();
    const jobId = randomUUID();
    await db.client.query('INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, 100)', [ownerId]);
    const guard = new BudgetReservationRepository(await createTestDataSource(db.container));

    await guard.reserve({ attempt: 1, estimatedCredits: 80, jobId, ownerId });
    await guard.reserve({ attempt: 1, estimatedCredits: 80, jobId, ownerId });
    await guard.settle({ attempt: 1, hasUncertainDispatch: false, jobId, knownActualCredits: 30, ownerId });
    await guard.settle({ attempt: 1, hasUncertainDispatch: false, jobId, knownActualCredits: 30, ownerId });

    const wallet = await db.client.query('SELECT "available_credits" AS "availableCredits", "reserved_credits" AS "reservedCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1', [ownerId]);
    expect(wallet.rows[0]).toEqual({ availableCredits: '70', reservedCredits: '0' });
    expect((await db.client.query('SELECT "business_key" FROM "course"."credit_ledger_entries" WHERE "job_id" = $1', [jobId])).rows).toHaveLength(3);
  });

  it('preserves overage instead of silently truncating known provider usage', async () => {
    const ownerId = randomUUID();
    const jobId = randomUUID();
    await db.client.query('INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, 100)', [ownerId]);
    const guard = new BudgetReservationRepository(await createTestDataSource(db.container));

    await guard.reserve({ attempt: 1, estimatedCredits: 80, jobId, ownerId });
    await guard.settle({ attempt: 1, hasUncertainDispatch: false, jobId, knownActualCredits: 120, ownerId });

    const wallet = await db.client.query('SELECT "available_credits" AS "availableCredits", "reserved_credits" AS "reservedCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1', [ownerId]);
    expect(wallet.rows[0]).toEqual({ availableCredits: '-20', reservedCredits: '0' });
    expect((await db.client.query('SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1', [`settle:${jobId}:1`])).rows[0]).toEqual({ credits: '120' });
  });

  it('holds the unverified reservation after an uncertain provider dispatch', async () => {
    const ownerId = randomUUID();
    const jobId = randomUUID();
    await db.client.query('INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, 100)', [ownerId]);
    const guard = new BudgetReservationRepository(await createTestDataSource(db.container));

    await guard.reserve({ attempt: 1, estimatedCredits: 80, jobId, ownerId });
    await guard.settle({ attempt: 1, hasUncertainDispatch: true, jobId, knownActualCredits: 15, ownerId });

    const wallet = await db.client.query('SELECT "available_credits" AS "availableCredits", "reserved_credits" AS "reservedCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1', [ownerId]);
    expect(wallet.rows[0]).toEqual({ availableCredits: '20', reservedCredits: '0' });
    expect((await db.client.query('SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1', [`hold:${jobId}:1`])).rows[0]).toEqual({ credits: '65' });
  });
});
