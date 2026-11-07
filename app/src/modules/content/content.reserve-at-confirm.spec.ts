import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { clearDocumentFlowData } from '../../../test/support/test-database-cleanup';
import { FakeModelCatalog, FAKE_PLAN_ESTIMATE_FOR_1024_BYTES, FAKE_PLAN_MODEL_ID } from '../../test-support/fake-model-catalog';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';
import { AiOutboxEvent } from '../ai/entities/ai-outbox-event.entity';
import { AiOutboxRepository } from '../ai/repositories/ai-outbox.repository';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import type { QuizGenerationHandoffPort } from '../assessment/contracts/quiz-generation-handoff.contract';
import { ReturnRelay } from '../../worker/return-relay.service';
import { ContentService } from './content.service';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { DocumentStatusProjectionService } from './document-status-projection.service';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ContentRepository } from './repositories/content.repository';

const WALLET_CREDITS = 2000;
const GO_QUEUE_ATTEMPT = 3;
const PLATFORM_MODEL = {
  creditPerInputToken: 1,
  creditPerOutputToken: 2,
  id: FAKE_PLAN_MODEL_ID,
  model: 'gpt-5.4-mini',
  planIds: ['free'],
};
const quizHandoff: QuizGenerationHandoffPort = {
  persist: async () => ({ optionCount: 0, questionCount: 0, questionIds: [], quizId: randomUUID() }),
};

interface WalletRow {
  readonly available_credits: string;
  readonly reserved_credits: string;
}

describe('PDF/TXT credit reservation at confirm and retry (#274)', () => {
  let db: TestDb;
  let ds: DataSource;
  let documents: Repository<Document>;
  let courseOutbox: Repository<OutboxEvent>;
  let aiOutbox: Repository<AiOutboxEvent>;
  let service: ContentService;

  beforeAll(async () => {
    db = await startTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    ds = await createTestDataSource(db.container);
    documents = ds.getRepository(Document);
    courseOutbox = ds.getRepository(OutboxEvent);
    aiOutbox = ds.getRepository(AiOutboxEvent);
    service = new ContentService(
      new ContentRepository(ds),
      { getBucketName: () => 'documents' } as never,
      new FakeStorageVerifier(),
      null as never,
      new FakeModelCatalog(),
    );
    await clearDocumentFlowData(db.client);
  });

  async function seedDocument(
    ownerId: string,
    overrides: Partial<Document> = {},
  ): Promise<Document> {
    return documents.save(documents.create({
      ownerId,
      originalName: 'bai-giang.pdf',
      sizeBytes: 1024,
      status: DocumentStatus.UPLOADED,
      storageRef: `${ownerId}/${randomUUID()}.pdf`,
      type: DocumentType.PDF,
      ...overrides,
    }));
  }

  async function seedWallet(ownerId: string, availableCredits = WALLET_CREDITS): Promise<void> {
    await db.client.query(
      'INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, $2)',
      [ownerId, availableCredits],
    );
  }

  async function readWallet(ownerId: string): Promise<WalletRow> {
    return (await db.client.query(
      'SELECT "available_credits", "reserved_credits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1',
      [ownerId],
    )).rows[0] as WalletRow;
  }

  async function readLedger(ownerId: string): Promise<Record<string, string>> {
    const rows = (await db.client.query(
      'SELECT "business_key", "credits" FROM "course"."credit_ledger_entries" WHERE "owner_id" = $1',
      [ownerId],
    )).rows as { business_key: string; credits: string }[];
    return Object.fromEntries(rows.map((row) => [row.business_key, row.credits]));
  }

  const createRelay = (): ReturnRelay => new ReturnRelay(
    new AiOutboxRepository(ds),
    new DocumentStatusProjectionService(
      new ContentRepository(ds),
      { ai: { platformModels: [PLATFORM_MODEL] } } as never,
      new MediaCreditEstimator(),
    ),
    quizHandoff,
  );

  async function seedResult(document: Document, overrides: Record<string, unknown>): Promise<void> {
    await aiOutbox.save(aiOutbox.create({
      aggregateId: document.fullPipelineJobId,
      eventType: 'DocumentProcessingResult',
      payload: {
        attempt: GO_QUEUE_ATTEMPT,
        budgetStatus: null,
        documentId: document.id,
        errorCode: null,
        errorMessage: null,
        estimateStatus: null,
        estimatedCredits: null,
        leaseId: randomUUID(),
        ownerId: document.ownerId,
        settledCredits: null,
        status: DocumentStatus.READY,
        version: 1,
        ...overrides,
      },
    }));
  }

  it('reserves the coarse estimate once, in the same transaction as PROCESSING and the outbox event', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId);

    const actualDocument = await service.confirm(inputOwnerId, inputDocument.id);

    const reloaded = await documents.findOneByOrFail({ id: inputDocument.id });
    const expectedKey = `reserve:${reloaded.fullPipelineJobId}:${reloaded.processingAttempt}`;
    expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
    expect(await readLedger(inputOwnerId)).toEqual({ [expectedKey]: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES) });
    expect(await readWallet(inputOwnerId)).toEqual({
      available_credits: String(WALLET_CREDITS - FAKE_PLAN_ESTIMATE_FOR_1024_BYTES),
      reserved_credits: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES),
    });
    expect(reloaded.budgetStatus).toBe('RESERVED');
    expect(reloaded.estimateStatus).toBe('COARSE');
    expect(Number(reloaded.estimatedCredits)).toBe(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES);
    expect(await courseOutbox.count({ where: { aggregateId: inputDocument.id } })).toBe(1);
  });

  it('does not reserve twice for a replayed or concurrent confirm', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId);

    await Promise.all([
      service.confirm(inputOwnerId, inputDocument.id),
      service.confirm(inputOwnerId, inputDocument.id),
    ]);
    await service.confirm(inputOwnerId, inputDocument.id);

    expect(Object.keys(await readLedger(inputOwnerId))).toHaveLength(1);
    expect((await readWallet(inputOwnerId)).reserved_credits).toBe(String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES));
    expect(await courseOutbox.count({ where: { aggregateId: inputDocument.id } })).toBe(1);
  });

  it('rejects confirm with 402 INSUFFICIENT_CREDITS and leaves no job, ledger row or state change', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId, FAKE_PLAN_ESTIMATE_FOR_1024_BYTES - 1);

    const actualError = await service.confirm(inputOwnerId, inputDocument.id).catch((error: unknown) => error);

    expect(actualError).toMatchObject({
      response: {
        availableCredits: FAKE_PLAN_ESTIMATE_FOR_1024_BYTES - 1,
        code: 'INSUFFICIENT_CREDITS',
        requiredCredits: FAKE_PLAN_ESTIMATE_FOR_1024_BYTES,
        shortfallCredits: 1,
      },
      status: 402,
    });
    const reloaded = await documents.findOneByOrFail({ id: inputDocument.id });
    expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
    expect(reloaded.processingAttempt).toBe(inputDocument.processingAttempt);
    expect(await readLedger(inputOwnerId)).toEqual({});
    expect(await readWallet(inputOwnerId)).toEqual({
      available_credits: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES - 1),
      reserved_credits: '0',
    });
    expect(await courseOutbox.count({ where: { aggregateId: inputDocument.id } })).toBe(0);
  });

  it('can confirm again after a top-up without re-uploading', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId, 1);
    await expect(service.confirm(inputOwnerId, inputDocument.id)).rejects.toMatchObject({ status: 402 });
    await db.client.query(
      'UPDATE "course"."owner_credit_wallets" SET "available_credits" = $2 WHERE "owner_id" = $1',
      [inputOwnerId, WALLET_CREDITS],
    );

    const actualDocument = await service.confirm(inputOwnerId, inputDocument.id);

    expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
    expect(Object.keys(await readLedger(inputOwnerId))).toHaveLength(1);
  });

  it('passes no reservation for a custom model (documents.platform_model_id is NOT NULL, so a CUSTOM row cannot be seeded)', async () => {
    const inputDocument = Object.assign(new Document(), {
      customModelConfigId: randomUUID(),
      id: randomUUID(),
      modelSelectionKind: 'CUSTOM' as const,
      originalName: 'bai-giang.pdf',
      platformModelId: null,
      sizeBytes: 1024,
      status: DocumentStatus.UPLOADED,
      storageRef: 'owner/bai-giang.pdf',
      type: DocumentType.PDF,
    });
    const recordedReservations: unknown[] = [];
    const mockRepository = {
      confirmProcessing: async (_ownerId: string, _id: string, _selection: unknown, reservation?: unknown): Promise<Document> => {
        recordedReservations.push(reservation);
        return inputDocument;
      },
      findByOwnerId: async (): Promise<Document> => inputDocument,
    };
    const customService = new ContentService(mockRepository as never, null as never, new FakeStorageVerifier(), null as never);

    await customService.confirm('owner', inputDocument.id);

    expect(recordedReservations).toEqual([undefined]);
  });

  it('retry after FAILED reserves under the new processing attempt key, and rejects a short balance leaving FAILED', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId);
    const first = await service.confirm(inputOwnerId, inputDocument.id);
    await seedResult(first, {
      errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      status: DocumentStatus.FAILED,
      usage: { llm: [], uncertainDispatches: 0 },
    });
    await createRelay().pump(10);
    const failed = await documents.findOneByOrFail({ id: inputDocument.id });
    expect(failed.status).toBe(DocumentStatus.FAILED);
    expect(await readWallet(inputOwnerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });

    const retried = await service.retry(inputOwnerId, inputDocument.id);

    const firstKey = `reserve:${first.fullPipelineJobId}:${Number(first.processingAttempt)}`;
    const secondKey = `reserve:${retried.fullPipelineJobId}:${Number(retried.processingAttempt)}`;
    expect(Number(retried.processingAttempt)).toBe(Number(first.processingAttempt) + 1);
    expect(secondKey).not.toBe(firstKey);
    expect(Object.keys(await readLedger(inputOwnerId))).toEqual(expect.arrayContaining([firstKey, secondKey]));
    expect((await readWallet(inputOwnerId)).reserved_credits).toBe(String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES));

    await seedResult(retried, {
      errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
      status: DocumentStatus.FAILED,
      usage: { llm: [], uncertainDispatches: 0 },
    });
    await createRelay().pump(10);
    await db.client.query(
      'UPDATE "course"."owner_credit_wallets" SET "available_credits" = 1 WHERE "owner_id" = $1',
      [inputOwnerId],
    );
    await expect(service.retry(inputOwnerId, inputDocument.id)).rejects.toMatchObject({ status: 402 });
    const stillFailed = await documents.findOneByOrFail({ id: inputDocument.id });
    expect(stillFailed.status).toBe(DocumentStatus.FAILED);
    expect(stillFailed.processingAttempt).toBe(retried.processingAttempt);
  });

  it('settles actual usage and releases the remainder when the PDF is READY through the return relay', async () => {
    const inputOwnerId = randomUUID();
    const inputDocument = await seedDocument(inputOwnerId);
    await seedWallet(inputOwnerId);
    const confirmed = await service.confirm(inputOwnerId, inputDocument.id);
    await seedResult(confirmed, {
      usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
    });

    await createRelay().pump(10);

    // 100 input * 1 + 20 output * 2 = 140 credits used; 768 - 140 = 628 released.
    const suffix = `${confirmed.fullPipelineJobId}:${Number(confirmed.processingAttempt)}`;
    expect(await readLedger(inputOwnerId)).toEqual({
      [`reserve:${suffix}`]: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES),
      [`settle:${suffix}`]: '140',
      [`release:${suffix}`]: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES - 140),
    });
    expect(await readWallet(inputOwnerId)).toEqual({
      available_credits: String(WALLET_CREDITS - 140),
      reserved_credits: '0',
    });
    const projected = await documents.findOneByOrFail({ id: inputDocument.id });
    expect(projected.status).toBe(DocumentStatus.READY);
    expect(projected.budgetStatus).toBe('SETTLED');
  });

  describe('Document deleted while processing', () => {
    const buckets = { documents: 'learning-platform-dev-documents', media: 'learning-platform-dev-media' };

    async function confirmThenDelete(): Promise<Document> {
      const inputOwnerId = randomUUID();
      const inputDocument = await seedDocument(inputOwnerId);
      await seedWallet(inputOwnerId);
      const confirmed = await service.confirm(inputOwnerId, inputDocument.id);
      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, inputDocument.id, buckets);
      return confirmed;
    }

    it('settles actual usage and releases the rest on READY while the Document stays DELETING', async () => {
      const confirmed = await confirmThenDelete();
      await seedResult(confirmed, {
        usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
      });

      await createRelay().pump(10);

      const suffix = `${confirmed.fullPipelineJobId}:${Number(confirmed.processingAttempt)}`;
      expect(await readLedger(confirmed.ownerId)).toEqual({
        [`reserve:${suffix}`]: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES),
        [`settle:${suffix}`]: '140',
        [`release:${suffix}`]: String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES - 140),
      });
      expect(await readWallet(confirmed.ownerId)).toEqual({
        available_credits: String(WALLET_CREDITS - 140),
        reserved_credits: '0',
      });
      expect((await documents.findOneByOrFail({ id: confirmed.id })).status).toBe(DocumentStatus.DELETING);
    });

    it('releases everything on a FAILED result before any provider call and stays idempotent on replay', async () => {
      const confirmed = await confirmThenDelete();
      const failedPayload = {
        errorCode: DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND,
        status: DocumentStatus.FAILED,
        usage: { llm: [], uncertainDispatches: 0 },
      };
      await seedResult(confirmed, failedPayload);
      await seedResult(confirmed, failedPayload);

      await createRelay().pump(10);

      expect(await readWallet(confirmed.ownerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
      expect(Object.keys(await readLedger(confirmed.ownerId))).toHaveLength(3);
      expect((await documents.findOneByOrFail({ id: confirmed.id })).status).toBe(DocumentStatus.DELETING);
    });

    it('skips without failing when the Document row is already gone', async () => {
      const confirmed = await confirmThenDelete();
      await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [confirmed.id]);
      await seedResult(confirmed, { usage: { llm: [], uncertainDispatches: 0 } });

      await createRelay().pump(10);

      expect((await readWallet(confirmed.ownerId)).reserved_credits).toBe(String(FAKE_PLAN_ESTIMATE_FOR_1024_BYTES));
      expect((await aiOutbox.find({ where: { aggregateId: confirmed.fullPipelineJobId } }))[0]?.publishedAt).not.toBeNull();
    });
  });
});
