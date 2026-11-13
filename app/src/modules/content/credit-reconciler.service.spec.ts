import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { clearDocumentFlowData } from '../../../test/support/test-database-cleanup';
import {
  createReconcilerService,
  IMMEDIATE_RECONCILER_SETTINGS,
  RECONCILER_AVAILABLE_AFTER_RESERVE,
  RECONCILER_PLATFORM_MODEL,
  RECONCILER_RESERVED_CREDITS,
  ReconcilerFixture,
  type ReconcilerRun,
} from '../../test-support/credit-reconciler-fixture';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { CreditReconcilerService } from './credit-reconciler.service';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ProcessingJobRepository } from '../ai/repositories/processing-job.repository';
import { CreditReconciliationRepository } from './repositories/credit-reconciliation.repository';
import { settleReservation } from './repositories/credit-settlement';
import type { CreditReconcilerSettings } from '../../config/configuration.types';

const ONE_DAY_IN_MINUTES = 24 * 60;
const HOLD_RELEASE_AFTER_ONE_DAY_MS = 86_400_000;
const GRACE_THIRTY_MINUTES_MS = 1_800_000;
const RECONCILER_LOCK_NAME = 'credit-reconciler';

describe('CreditReconcilerService', () => {
  let db: TestDb;
  let ds: DataSource;
  let fixture: ReconcilerFixture;
  let logSpy: jest.SpiedFunction<ConsoleLogger['log']>;
  let errorSpy: jest.SpiedFunction<ConsoleLogger['error']>;

  const reconcilerWith = (overrides: Partial<CreditReconcilerSettings> = {}): CreditReconcilerService => createReconcilerService(
    ds,
    // Keep a HOLD the reconciler just created from being auto-released in the same run, unless a test wants it.
    { ...IMMEDIATE_RECONCILER_SETTINGS, heldReleaseAfterMs: HOLD_RELEASE_AFTER_ONE_DAY_MS, ...overrides },
  );

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    ds = await createTestDataSource(db.container);
    fixture = new ReconcilerFixture(db, ds);
    await clearDocumentFlowData(db.client);
    logSpy = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await ds.destroy();
  });

  async function markDeleting(run: ReconcilerRun): Promise<void> {
    await db.client.query('UPDATE "course"."documents" SET "status" = \'DELETING\' WHERE "id" = $1', [run.document.id]);
  }

  async function setDocumentStatus(run: ReconcilerRun, status: DocumentStatus): Promise<void> {
    await db.client.query('UPDATE "course"."documents" SET "status" = $2 WHERE "id" = $1', [run.document.id, status]);
  }

  function expectLedger(run: ReconcilerRun, entries: Record<string, number>): Promise<void> {
    return fixture.readLedger(run.jobId).then((actualLedger) => {
      expect(actualLedger).toEqual(Object.fromEntries(Object.entries(entries).map(([kind, credits]) => [
        `${kind}:${run.jobId}:${run.document.processingAttempt}`, String(credits),
      ])));
    });
  }

  describe('orphan reservations', () => {
    it('leaves a reservation inside the grace period untouched', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);

      const actualReport = await reconcilerWith({ orphanGraceMs: GRACE_THIRTY_MINUTES_MS }).reconcileOnce();

      expect(actualReport).toMatchObject({ outcome: 'COMPLETED', scannedReservations: 0, settledCount: 0 });
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
    });

    it('skips an aged reservation whose terminal evidence is still inside the grace period', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { cancelled: true });
      await db.client.query('UPDATE "course"."credit_ledger_entries" SET "created_at" = now() - interval \'2 hours\' WHERE "job_id" = $1', [run.jobId]);

      const actualReport = await reconcilerWith({ orphanGraceMs: GRACE_THIRTY_MINUTES_MS }).reconcileOnce();

      expect(actualReport).toMatchObject({ scannedReservations: 1, settledCount: 0, skippedLive: 1 });
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
    });

    it('skips a reservation whose result is written but not yet published, so the relay settles it', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { status: 'FAILED' });
      await fixture.seedResult(run, { isPublished: false, payload: { status: 'FAILED' } });
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ scannedReservations: 1, settledCount: 0, skippedInFlight: 1 });
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
    });

    it('skips a reservation whose Document row is locked by another transaction', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { cancelled: true });
      await fixture.age(run, 60);
      const blocker = new Client({ connectionString: db.container.getConnectionUri() });
      await blocker.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT 1 FROM "course"."documents" WHERE "id" = $1 FOR UPDATE', [run.document.id]);

        const actualReport = await reconcilerWith().reconcileOnce();

        expect(actualReport).toMatchObject({ settledCount: 0, skippedLocked: 1 });
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
    });

    it('never touches a PROCESSING Document whose job is still live', async () => {
      const run = await fixture.seedRun();
      await fixture.seedJob(run, { status: 'RUNNING' });
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ scannedReservations: 1, settledCount: 0, skippedLive: 1 });
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '1000' });
    });

    it('never touches a PROCESSING Document that is reserved but whose job was not forwarded yet', async () => {
      const run = await fixture.seedRun();
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ settledCount: 0, skippedLive: 1 });
    });

    it('releases everything when a pre-#273 FAILED result proves the failure came before any provider call', async () => {
      const run = await fixture.seedRun({ documentStatus: DocumentStatus.FAILED });
      await fixture.seedJob(run, { status: 'FAILED' });
      await fixture.seedResult(run, {
        isPublished: true,
        payload: { errorCode: DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND, status: 'FAILED' },
      });
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ releasedCount: 1, releasedCredits: 1000, settledCount: 1 });
      await expectLedger(run, { release: 1000, reserve: 1000, settle: 0 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '5000', reserved_credits: '0' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'SETTLED', settled_credits: '0', status: 'FAILED' });
    });

    it('holds everything when a pre-#273 READY result carries no usage', async () => {
      const run = await fixture.seedRun({ documentStatus: DocumentStatus.READY });
      await fixture.seedJob(run, { status: 'COMPLETED' });
      await fixture.seedResult(run, { isPublished: true, payload: { status: 'READY' } });
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ heldCount: 1, heldCredits: 1000 });
      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '0' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD', status: 'READY' });
    });

    it('settles a published result that has usage with the relay pricing', async () => {
      const run = await fixture.seedRun({ documentStatus: DocumentStatus.READY });
      await fixture.seedJob(run, { status: 'COMPLETED' });
      await fixture.seedResult(run, {
        isPublished: true,
        payload: { usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 } },
      });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { release: 600, reserve: 1000, settle: 400 });
    });

    it('settles a superseded attempt under its own key without touching the newer attempt budget status', async () => {
      const run = await fixture.seedRun();
      await fixture.seedJob(run, { status: 'FAILED' });
      await fixture.seedResult(run, {
        isPublished: true,
        payload: {
          errorCode: DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID,
          status: 'FAILED',
          usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
        },
      });
      await fixture.age(run, 120);
      // The user retried: attempt 3 reserved later, the same queue row re-armed and RUNNING.
      await fixture.seedReserve(run.ownerId, run.jobId, 3);
      await db.client.query(
        'UPDATE "course"."documents" SET "processing_attempt" = 3, "budget_status" = \'RESERVED\' WHERE "id" = $1',
        [run.document.id],
      );
      await db.client.query('UPDATE "ai"."processing_jobs" SET "processing_attempt" = 3, "status" = \'RUNNING\', "attempts" = 3 WHERE "id" = $1', [run.jobId]);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ settledCount: 1, skippedLive: 1 });
      const actualLedger = await fixture.readLedger(run.jobId);
      expect(actualLedger).toEqual({
        [`reserve:${run.jobId}:2`]: '1000',
        [`settle:${run.jobId}:2`]: '140',
        [`release:${run.jobId}:2`]: '860',
        [`reserve:${run.jobId}:3`]: '1000',
      });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'RESERVED', settled_credits: null });
    });

    it('settles the billed speech-to-text and holds the rest when a deleted media Document has an uncertain chunk', async () => {
      const run = await fixture.seedRun({ type: DocumentType.VIDEO });
      await markDeleting(run);
      const probeResultId = await fixture.seedSttCheckpoint(run, { billedMs: 10_000, uncertainMs: 5_000 });
      await fixture.seedJob(run, { cancelled: true, probeResultId });
      await fixture.age(run, 60);
      const expectedSttCredits = new MediaCreditEstimator().calculateActual({
        defaultModel: RECONCILER_PLATFORM_MODEL,
        model: RECONCILER_PLATFORM_MODEL,
        usage: { llm: [], sttBilledSeconds: 10, sttUncertainSeconds: 5, uncertainDispatches: 0 },
      }).sttCredits;

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(expectedSttCredits).toBeGreaterThan(0);
      expect(actualReport).toMatchObject({ heldCount: 1, heldCredits: RECONCILER_RESERVED_CREDITS - expectedSttCredits });
      await expectLedger(run, {
        hold: RECONCILER_RESERVED_CREDITS - expectedSttCredits,
        release: 0,
        reserve: RECONCILER_RESERVED_CREDITS,
        settle: expectedSttCredits,
      });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD', status: 'DELETING' });
    });

    it('settles usage records that are all AVAILABLE and releases the remainder', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { cancelled: true });
      await fixture.seedUsageRecord(run, { inputTokens: 200, outputTokens: 20, status: 'AVAILABLE' });
      await fixture.seedUsageRecord(run, { inputTokens: 100, outputTokens: 30, status: 'AVAILABLE' });
      // A cached UNAVAILABLE row never reached the provider, so it is not an uncertain dispatch.
      await fixture.seedUsageRecord(run, { cached: true, status: 'UNAVAILABLE' });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      // 300 input * 1 + 50 output * 2 = 400.
      await expectLedger(run, { release: 600, reserve: 1000, settle: 400 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4600', reserved_credits: '0' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'SETTLED', settled_credits: '400', status: 'DELETING' });
    });

    it('holds the remainder when a usage record has an unknown outcome', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { cancelled: true });
      await fixture.seedUsageRecord(run, { inputTokens: 100, outputTokens: 0, status: 'AVAILABLE' });
      await fixture.seedUsageRecord(run, { status: 'UNAVAILABLE' });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { hold: 900, release: 0, reserve: 1000, settle: 100 });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD', settled_credits: '100' });
    });

    it('holds when the job row predates attempt tracking, even without any usage record', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { cancelled: true, processingAttempt: null });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
    });

    it('releases fully when the Document was deleted before its job was ever claimed', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { attempts: 1, cancelled: true });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { release: 1000, reserve: 1000, settle: 0 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '5000', reserved_credits: '0' });
    });

    it('releases fully when the Document was deleted after the reserve but before the job was forwarded', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { release: 1000, reserve: 1000, settle: 0 });
    });

    it('settles a reservation whose Document row is gone, pricing from the job model', async () => {
      const run = await fixture.seedRun();
      await fixture.seedJob(run, { cancelled: true });
      await fixture.seedUsageRecord(run, { inputTokens: 100, outputTokens: 0, status: 'AVAILABLE' });
      await fixture.age(run, 60);
      await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [run.document.id]);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { release: 900, reserve: 1000, settle: 100 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4900', reserved_credits: '0' });
    });

    it('settles a revoked account job by the same evidence rules without changing the Document status', async () => {
      const run = await fixture.seedRun();
      await fixture.seedJob(run, { cancelled: true });
      await db.client.query(
        'INSERT INTO "ai"."account_access_revocations" ("user_id", "reason_code", "event_idempotency_key") VALUES ($1, \'ACCOUNT_DELETED\', $2)',
        [run.ownerId, `revoke:${run.ownerId}`],
      );
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      // Claimed with no provider record: a dispatch may have been in flight, so it is held, and the Document stays PROCESSING.
      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD', status: 'PROCESSING' });
    });

    it('holds a text job cancelled after it was claimed when no usage record exists', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { attempts: 2, cancelled: true });
      await fixture.age(run, 60);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
    });

    it('ignores the speech-to-text of a re-armed job row and holds the older attempt of a media Document', async () => {
      const run = await fixture.seedRun({ type: DocumentType.VIDEO });
      await fixture.seedResult(run, { isPublished: true, payload: { status: 'FAILED', errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE } });
      await db.client.query('DELETE FROM "ai"."outbox" WHERE "aggregate_id" = $1', [run.jobId]);
      const probeResultId = await fixture.seedSttCheckpoint(run, { billedMs: 10_000, uncertainMs: 0 });
      await fixture.seedJob(run, { probeResultId, status: 'FAILED' });
      await fixture.age(run, 120);
      // Retry: attempt 3 reserved, the row re-armed and finished; its checkpoints belong to attempt 3.
      await fixture.seedReserve(run.ownerId, run.jobId, 3);
      await db.client.query('UPDATE "course"."documents" SET "processing_attempt" = 3 WHERE "id" = $1', [run.document.id]);
      await db.client.query('UPDATE "ai"."processing_jobs" SET "processing_attempt" = 3, "attempts" = 3 WHERE "id" = $1', [run.jobId]);

      await reconcilerWith().reconcileOnce();

      const actualLedger = await fixture.readLedger(run.jobId);
      expect(actualLedger[`settle:${run.jobId}:2`]).toBe('0');
      expect(actualLedger[`hold:${run.jobId}:2`]).toBe('1000');
      expect(actualLedger[`release:${run.jobId}:2`]).toBe('0');
    });

    it('holds when a result exists but a newer Document attempt has no reserve boundary', async () => {
      const run = await fixture.seedRun({ documentStatus: DocumentStatus.READY });
      await fixture.seedJob(run, { status: 'COMPLETED' });
      await fixture.seedResult(run, {
        isPublished: true,
        payload: { usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 } },
      });
      await fixture.age(run, 60);
      await db.client.query('UPDATE "course"."documents" SET "processing_attempt" = 3 WHERE "id" = $1', [run.document.id]);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
    });

    it('treats an active job that may still be running the attempt as live even when the Document moved on', async () => {
      const run = await fixture.seedRun();
      await fixture.seedJob(run, { status: 'RUNNING' });
      await fixture.age(run, 120);
      await fixture.seedReserve(run.ownerId, run.jobId, 3);
      await db.client.query('UPDATE "course"."documents" SET "processing_attempt" = 3 WHERE "id" = $1', [run.document.id]);

      const actualReport = await reconcilerWith().reconcileOnce();

      expect(actualReport).toMatchObject({ settledCount: 0 });
      expect(await fixture.readLedger(run.jobId)).not.toHaveProperty(`settle:${run.jobId}:2`);
    });

    it('holds a legacy reservation that has neither a Document nor a job', async () => {
      const run = await fixture.seedRun();
      await fixture.age(run, 60);
      await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [run.document.id]);

      await reconcilerWith().reconcileOnce();

      await expectLedger(run, { hold: 1000, release: 0, reserve: 1000, settle: 0 });
    });

    it('reports FAILED instead of throwing when the settings are invalid', async () => {
      const service = new CreditReconcilerService(
        new CreditReconciliationRepository(ds, new ProcessingJobRepository(ds)),
        { get creditReconciler(): never { throw new Error('invalid settings'); } } as never,
        new MediaCreditEstimator(),
      );

      await expect(service.reconcileOnce()).resolves.toMatchObject({ outcome: 'FAILED' });
    });

    it('computes and logs the decision but writes nothing on a dry run', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.seedJob(run, { attempts: 1, cancelled: true });
      await fixture.age(run, 60);

      const actualReport = await reconcilerWith({ dryRun: true }).reconcileOnce();

      expect(actualReport).toMatchObject({ mode: 'dry-run', releasedCount: 1, releasedCredits: 1000 });
      await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '1000' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'RESERVED' });
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        category: 'DELETED', decision: 'RELEASE', dryRun: true, event: 'credit.reconcile.reservation_resolved', evidence: 'NEVER_CLAIMED',
      }));
    });

    it('reports a skipped run while another reconciler holds the advisory lock', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.age(run, 60);
      const holder = new Client({ connectionString: db.container.getConnectionUri() });
      await holder.connect();
      try {
        await holder.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [RECONCILER_LOCK_NAME]);

        const actualReport = await reconcilerWith().reconcileOnce();

        expect(actualReport.outcome).toBe('SKIPPED_LOCK_HELD');
        await expectLedger(run, { reserve: RECONCILER_RESERVED_CREDITS });
      } finally {
        await holder.end();
      }
    });

    it('settles once when two reconcilers run at the same time', async () => {
      const run = await fixture.seedRun();
      await markDeleting(run);
      await fixture.age(run, 60);

      const actualReports = await Promise.all([reconcilerWith().reconcileOnce(), reconcilerWith().reconcileOnce()]);

      expect(actualReports.reduce((total, report) => total + report.settledCount, 0)).toBe(1);
      await expectLedger(run, { release: 1000, reserve: 1000, settle: 0 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '5000', reserved_credits: '0' });
    });

    it('reports FAILED and logs the stage instead of throwing when the database errors', async () => {
      const broken = createReconcilerService(ds, IMMEDIATE_RECONCILER_SETTINGS);
      await ds.destroy();

      const actualReport = await broken.reconcileOnce();

      expect(actualReport.outcome).toBe('FAILED');
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'credit.reconcile.failed', stage: 'run' }));
      ds = await createTestDataSource(db.container);
    });

    it('keeps going when one reservation fails and logs it with its stage', async () => {
      const good = await fixture.seedRun();
      await markDeleting(good);
      await fixture.age(good, 60);
      const service = reconcilerWith();
      const repository = (service as unknown as { repository: { reconcileReservation: (input: unknown) => Promise<unknown> } }).repository;
      const realReconcile = repository.reconcileReservation.bind(repository);
      let isFirstCall = true;
      jest.spyOn(repository, 'reconcileReservation').mockImplementation(async (input) => {
        if (isFirstCall) {
          isFirstCall = false;
          throw new Error('boom');
        }
        return realReconcile(input);
      });
      const second = await fixture.seedRun();
      await markDeleting(second);
      await fixture.age(second, 59);

      const actualReport = await service.reconcileOnce();

      expect(actualReport).toMatchObject({ outcome: 'COMPLETED', scannedReservations: 2, settledCount: 1 });
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'credit.reconcile.failed', stage: 'reservation' }));
    });
  });

  describe('HELD auto-release', () => {
    async function seedHeldRun(options: { readonly attempt?: number } = {}): Promise<ReconcilerRun> {
      const run = await fixture.seedRun({ documentStatus: DocumentStatus.READY, processingAttempt: options.attempt });
      await fixture.seedJob(run, { status: 'COMPLETED' });
      const attempt = Number(run.document.processingAttempt);
      await ds.transaction((manager) => settleReservation(manager, {
        hasUncertainDispatch: true, jobId: run.jobId, knownActualCredits: 100, ownerId: run.ownerId, processingAttempt: attempt,
      }));
      await db.client.query('UPDATE "course"."documents" SET "budget_status" = \'HELD\' WHERE "id" = $1', [run.document.id]);
      return run;
    }

    const releaseSettings = (overrides: Partial<CreditReconcilerSettings> = {}): CreditReconcilerService => reconcilerWith({
      heldReleaseAfterMs: 1, ...overrides,
    });

    it('releases an expired HOLD once: available grows by the held credits and the Document becomes SETTLED', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);

      const actualReport = await releaseSettings().reconcileOnce();

      expect(actualReport).toMatchObject({ heldReleasedCount: 1, heldReleasedCredits: 900, heldScanned: 1 });
      const actualLedger = await fixture.readLedger(run.jobId);
      expect(actualLedger).toEqual({
        [fixture.key('hold', run)]: '900',
        [fixture.key('hold-release', run)]: '900',
        [fixture.key('release', run)]: '0',
        [fixture.key('reserve', run)]: '1000',
        [fixture.key('settle', run)]: '100',
      });
      expect(await fixture.readWallet(run.ownerId)).toEqual({
        available_credits: String(RECONCILER_AVAILABLE_AFTER_RESERVE + 900),
        reserved_credits: '0',
      });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'SETTLED' });
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        credits: 900, documentId: run.document.id, event: 'credit.hold.auto_released', jobId: run.jobId,
      }));
    });

    it('records the release as a RELEASE ledger entry', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);

      await releaseSettings().reconcileOnce();

      const rows = (await db.client.query(
        'SELECT "entry_type" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1',
        [fixture.key('hold-release', run)],
      )).rows as { entry_type: string }[];
      expect(rows).toEqual([{ entry_type: 'RELEASE' }]);
    });

    it('never releases twice across a second run or concurrent runs', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);

      await Promise.all([releaseSettings().reconcileOnce(), releaseSettings().reconcileOnce()]);
      const secondReport = await releaseSettings().reconcileOnce();

      expect(secondReport.heldReleasedCount).toBe(0);
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4900', reserved_credits: '0' });
    });

    it('releases once when the release races on the same HOLD from two transactions', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);
      const repository = new CreditReconciliationRepository(ds, new ProcessingJobRepository(ds));
      const [candidate] = await repository.findExpiredHoldCandidates({ after: null, limit: 10, releaseAfterMs: 1 });

      const results = await Promise.all([repository.releaseExpiredHold(candidate!), repository.releaseExpiredHold(candidate!)]);

      expect(results.filter((result) => result.kind === 'RELEASED')).toHaveLength(1);
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4900', reserved_credits: '0' });
    });

    it('leaves a HOLD younger than the threshold untouched', async () => {
      const run = await seedHeldRun();

      const actualReport = await releaseSettings({ heldReleaseAfterMs: HOLD_RELEASE_AFTER_ONE_DAY_MS }).reconcileOnce();

      expect(actualReport).toMatchObject({ heldReleasedCount: 0, heldScanned: 0 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '0' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD' });
    });

    it('keeps the budget status of a newer attempt when an older attempt HOLD is released', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);
      await db.client.query(
        'UPDATE "course"."documents" SET "processing_attempt" = 3, "budget_status" = \'HELD\' WHERE "id" = $1',
        [run.document.id],
      );

      await releaseSettings().reconcileOnce();

      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4900', reserved_credits: '0' });
      expect(await fixture.readDocument(run.document.id)).toMatchObject({ budget_status: 'HELD' });
    });

    it('still releases a HOLD whose Document row no longer exists', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);
      await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [run.document.id]);

      const actualReport = await releaseSettings().reconcileOnce();

      expect(actualReport.heldReleasedCount).toBe(1);
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4900', reserved_credits: '0' });
    });

    it('does not release on a dry run', async () => {
      const run = await seedHeldRun();
      await fixture.age(run, ONE_DAY_IN_MINUTES + 1);

      const actualReport = await releaseSettings({ dryRun: true }).reconcileOnce();

      expect(actualReport).toMatchObject({ heldReleasedCount: 0, heldScanned: 1 });
      expect(await fixture.readWallet(run.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '0' });
    });
  });
});
