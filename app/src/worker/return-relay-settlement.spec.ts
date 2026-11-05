import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { DocumentProcessingFailureCode } from '../modules/ai/contracts/document-processing-result';
import { AiOutboxEvent } from '../modules/ai/entities/ai-outbox-event.entity';
import { AiOutboxRepository } from '../modules/ai/repositories/ai-outbox.repository';
import { AssessmentError, AssessmentErrorCode } from '../modules/assessment/domain/assessment.error';
import type { QuizGenerationHandoffPort } from '../modules/assessment/contracts/quiz-generation-handoff.contract';
import { MediaCreditEstimator } from '../modules/content/credit-estimation/media-credit-estimator';
import { DocumentStatusProjectionService } from '../modules/content/document-status-projection.service';
import { Document } from '../modules/content/entities/document.entity';
import { DocumentStatus } from '../modules/content/enums/document-status.enum';
import { DocumentType } from '../modules/content/enums/document-type.enum';
import { ContentRepository } from '../modules/content/repositories/content.repository';
import { createTestDataSource } from '../test-support/test-data-source';
import { startTestDb, TestDb } from '../test-support/test-db';
import { clearDocumentFlowData } from '../../test/support/test-database-cleanup';
import { ReturnRelay } from './return-relay.service';

const RESERVED_CREDITS = 1000;
const AVAILABLE_CREDITS_AFTER_RESERVE = 4000;
const PROCESSING_ATTEMPT = 2;
// The Go queue attempt is bumped by every technical retry, so it differs from the Document's processingAttempt.
const GO_QUEUE_ATTEMPT = 4;
const PLATFORM_MODEL = {
  creditPerInputToken: 1,
  creditPerOutputToken: 2,
  id: 'platform-test',
  model: 'gpt-5.4-mini',
  planIds: ['free'],
};
const quizHandoff: QuizGenerationHandoffPort = {
  persist: async () => ({ optionCount: 0, questionCount: 0, questionIds: [], quizId: randomUUID() }),
};

interface SeededRun {
  readonly document: Document;
  readonly jobId: string;
}

interface WalletRow {
  readonly available_credits: string;
  readonly reserved_credits: string;
}

describe('ReturnRelay credit settlement (#160 D7)', () => {
  let db: TestDb;
  let ds: DataSource;
  let documents: Repository<Document>;
  let outbox: Repository<AiOutboxEvent>;
  let relay: ReturnRelay;

  const createRelay = (handoff: QuizGenerationHandoffPort = quizHandoff): ReturnRelay => new ReturnRelay(
    new AiOutboxRepository(ds),
    new DocumentStatusProjectionService(
      new ContentRepository(ds),
      { ai: { platformModels: [PLATFORM_MODEL] } } as never,
      new MediaCreditEstimator(),
    ),
    handoff,
  );

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    ds = await createTestDataSource(db.container);
    documents = ds.getRepository(Document);
    outbox = ds.getRepository(AiOutboxEvent);
    relay = createRelay();
    await clearDocumentFlowData(db.client);
  });

  async function seedReservedRun(withReservation = true): Promise<SeededRun> {
    const ownerId = randomUUID();
    const jobId = randomUUID();
    const document = await documents.save(documents.create({
      budgetStatus: withReservation ? 'RESERVED' : 'NOT_RESERVED',
      estimatedCredits: RESERVED_CREDITS,
      fullPipelineJobId: jobId,
      modelSelectionKind: 'PLAN',
      originalName: 'lecture.mp4',
      ownerId,
      platformModelId: PLATFORM_MODEL.id,
      processingAttempt: PROCESSING_ATTEMPT,
      sizeBytes: 100,
      status: DocumentStatus.PROCESSING,
      storageRef: `media/${randomUUID()}.mp4`,
      type: DocumentType.VIDEO,
    }));
    await db.client.query(
      'INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits", "reserved_credits") VALUES ($1, $2, $3)',
      [ownerId, AVAILABLE_CREDITS_AFTER_RESERVE, withReservation ? RESERVED_CREDITS : 0],
    );
    if (withReservation) {
      await db.client.query(
        'INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, \'RESERVE\', $5)',
        [ownerId, jobId, PROCESSING_ATTEMPT, `reserve:${jobId}:${PROCESSING_ATTEMPT}`, RESERVED_CREDITS],
      );
    }
    return { document, jobId };
  }

  async function seedResult(
    run: SeededRun,
    overrides: Record<string, unknown>,
    aggregateId = run.jobId,
  ): Promise<AiOutboxEvent> {
    return outbox.save(outbox.create({
      aggregateId,
      eventType: 'DocumentProcessingResult',
      payload: {
        attempt: GO_QUEUE_ATTEMPT,
        budgetStatus: null,
        documentId: run.document.id,
        errorCode: null,
        errorMessage: null,
        estimateStatus: null,
        estimatedCredits: null,
        leaseId: randomUUID(),
        ownerId: run.document.ownerId,
        settledCredits: null,
        status: DocumentStatus.READY,
        version: 1,
        ...overrides,
      },
    }));
  }

  const failedPayload = (errorCode: DocumentProcessingFailureCode): Record<string, unknown> => ({
    errorCode,
    errorMessage: null,
    status: DocumentStatus.FAILED,
  });

  async function readLedger(jobId: string): Promise<Record<string, string>> {
    const rows = (await db.client.query(
      'SELECT "business_key", "credits" FROM "course"."credit_ledger_entries" WHERE "job_id" = $1',
      [jobId],
    )).rows as { business_key: string; credits: string }[];
    return Object.fromEntries(rows.map((row) => [row.business_key, row.credits]));
  }

  async function readWallet(ownerId: string): Promise<WalletRow> {
    return (await db.client.query(
      'SELECT "available_credits", "reserved_credits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1',
      [ownerId],
    )).rows[0] as WalletRow;
  }

  const key = (kind: string, jobId: string): string => `${kind}:${jobId}:${PROCESSING_ATTEMPT}`;

  it('settles the actual usage and releases the remainder on success, keyed by processingAttempt', async () => {
    const run = await seedReservedRun();
    const event = await seedResult(run, {
      usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 },
    });

    await relay.pump(10);

    // 300 input * 1 + 50 output * 2 = 400 credits used; 600 released.
    expect(await readLedger(run.jobId)).toEqual({
      [key('reserve', run.jobId)]: '1000',
      [key('settle', run.jobId)]: '400',
      [key('release', run.jobId)]: '600',
    });
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4600', reserved_credits: '0' });
    const projected = await documents.findOneByOrFail({ id: run.document.id });
    expect(projected.status).toBe(DocumentStatus.READY);
    expect(projected.budgetStatus).toBe('SETTLED');
    expect(projected.settledCredits).toBe('400');
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('never keys the settlement by the Go queue attempt', async () => {
    const run = await seedReservedRun();
    await seedResult(run, { usage: { llm: [], uncertainDispatches: 0 } });

    await relay.pump(10);

    const keys = Object.keys(await readLedger(run.jobId));
    expect(keys).not.toContain(`settle:${run.jobId}:${GO_QUEUE_ATTEMPT}`);
    expect(keys).toContain(key('settle', run.jobId));
  });

  it('releases the whole reservation when the attempt fails before any provider call', async () => {
    const run = await seedReservedRun();
    await seedResult(run, {
      ...failedPayload(DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND),
      usage: { llm: [], uncertainDispatches: 0 },
    });

    await relay.pump(10);

    expect(await readLedger(run.jobId)).toEqual({
      [key('reserve', run.jobId)]: '1000',
      [key('settle', run.jobId)]: '0',
      [key('release', run.jobId)]: '1000',
    });
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '5000', reserved_credits: '0' });
    const projected = await documents.findOneByOrFail({ id: run.document.id });
    expect(projected.status).toBe(DocumentStatus.FAILED);
    expect(projected.budgetStatus).toBe('SETTLED');
    expect(projected.settledCredits).toBe('0');
  });

  it('settles what was spent and releases the rest when the attempt fails after provider calls', async () => {
    const run = await seedReservedRun();
    await seedResult(run, {
      ...failedPayload(DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID),
      usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
    });

    await relay.pump(10);

    expect(await readLedger(run.jobId)).toEqual({
      [key('reserve', run.jobId)]: '1000',
      [key('settle', run.jobId)]: '140',
      [key('release', run.jobId)]: '860',
    });
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4860', reserved_credits: '0' });
  });

  it('holds the unverified remainder when a provider dispatch has an unknown outcome', async () => {
    const run = await seedReservedRun();
    await seedResult(run, {
      ...failedPayload(DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE),
      usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 0 }], uncertainDispatches: 1 },
    });

    await relay.pump(10);

    expect(await readLedger(run.jobId)).toEqual({
      [key('reserve', run.jobId)]: '1000',
      [key('settle', run.jobId)]: '100',
      [key('release', run.jobId)]: '0',
      [key('hold', run.jobId)]: '900',
    });
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '0' });
    const projected = await documents.findOneByOrFail({ id: run.document.id });
    expect(projected.budgetStatus).toBe('HELD');
    expect(projected.settledCredits).toBe('100');
  });

  it('is idempotent for a replayed or duplicated return event', async () => {
    const run = await seedReservedRun();
    const usage = { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 };
    const payload = { attempt: GO_QUEUE_ATTEMPT, leaseId: randomUUID(), usage };
    await seedResult(run, payload);
    await seedResult(run, payload);

    await relay.pump(10);
    await relay.pump(10);
    await seedResult(run, payload);
    await relay.pump(10);

    expect(Object.keys(await readLedger(run.jobId))).toHaveLength(3);
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4600', reserved_credits: '0' });
    expect((await documents.findOneByOrFail({ id: run.document.id })).settledCredits).toBe('400');
  });

  it('settles an older payload without usage conservatively: held after success, released only before any provider call', async () => {
    const success = await seedReservedRun();
    await seedResult(success, {});
    const unspent = await seedReservedRun();
    await seedResult(unspent, failedPayload(DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND));
    const unknown = await seedReservedRun();
    await seedResult(unknown, failedPayload(DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE));

    await relay.pump(10);

    expect(await readLedger(success.jobId)).toEqual({
      [key('reserve', success.jobId)]: '1000',
      [key('settle', success.jobId)]: '0',
      [key('release', success.jobId)]: '0',
      [key('hold', success.jobId)]: '1000',
    });
    expect(await readLedger(unspent.jobId)).toEqual({
      [key('reserve', unspent.jobId)]: '1000',
      [key('settle', unspent.jobId)]: '0',
      [key('release', unspent.jobId)]: '1000',
    });
    expect(Object.keys(await readLedger(unknown.jobId))).toContain(key('hold', unknown.jobId));
  });

  it('treats malformed usage like absent usage instead of blocking the relay', async () => {
    const run = await seedReservedRun();
    const event = await seedResult(run, { usage: { llm: [{ inputTokens: -1, model: 'gpt-5.4-mini', outputTokens: 0 }] } });

    await relay.pump(10);

    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
    expect(Object.keys(await readLedger(run.jobId))).toContain(key('hold', run.jobId));
  });

  it('holds instead of guessing when the reported model has no configured platform pricing', async () => {
    const run = await seedReservedRun();
    await documents.update({ id: run.document.id }, { platformModelId: 'removed-from-config' });
    await seedResult(run, { usage: { llm: [{ inputTokens: 10, model: 'gpt-5.4-mini', outputTokens: 1 }], uncertainDispatches: 0 } });
    const logger = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);

    await relay.pump(10);

    logger.mockRestore();
    expect(Object.keys(await readLedger(run.jobId))).toContain(key('hold', run.jobId));
  });

  it('does nothing to the ledger when no credit was reserved (PDF/TXT on the Go path)', async () => {
    const run = await seedReservedRun(false);
    await seedResult(run, { usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 } });

    await relay.pump(10);

    expect(await readLedger(run.jobId)).toEqual({});
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '0' });
    const projected = await documents.findOneByOrFail({ id: run.document.id });
    expect(projected.status).toBe(DocumentStatus.READY);
    expect(projected.budgetStatus).toBe('NOT_RESERVED');
  });

  it('does not settle another job reservation when the event job id is not the Document pipeline job', async () => {
    const run = await seedReservedRun();
    await seedResult(run, { usage: { llm: [], uncertainDispatches: 0 } }, randomUUID());

    await relay.pump(10);

    expect(Object.keys(await readLedger(run.jobId))).toEqual([key('reserve', run.jobId)]);
    expect(await readWallet(run.document.ownerId)).toEqual({ available_credits: '4000', reserved_credits: '1000' });
  });

  it('keeps one settlement when invalid generated questions turn a READY result into FAILED', async () => {
    const run = await seedReservedRun();
    const chunkId = randomUUID();
    await seedResult(run, {
      questions: [{
        chunkId,
        chunkIndex: 0,
        citation: { chunkId, locator: { kind: 'page', page: 1 }, snippet: 'snippet' },
        explanation: 'explanation',
        options: [{ content: 'a', isCorrect: true }, { content: 'b', isCorrect: false }],
        ordinal: 0,
        stem: 'stem',
      }],
      usage: { llm: [{ inputTokens: 300, model: 'gpt-5.4-mini', outputTokens: 50 }], uncertainDispatches: 0 },
    });
    const logger = jest.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined);
    const terminalRelay = createRelay({
      persist: async () => {
        throw new AssessmentError(AssessmentErrorCode.INSUFFICIENT_VALID_QUESTIONS, 0, 1);
      },
    });

    await terminalRelay.pump(10);

    logger.mockRestore();
    const projected = await documents.findOneByOrFail({ id: run.document.id });
    expect(projected.status).toBe(DocumentStatus.FAILED);
    expect(projected.budgetStatus).toBe('SETTLED');
    expect(projected.settledCredits).toBe('400');
    expect(await readLedger(run.jobId)).toEqual({
      [key('reserve', run.jobId)]: '1000',
      [key('settle', run.jobId)]: '400',
      [key('release', run.jobId)]: '600',
    });
  });
});
