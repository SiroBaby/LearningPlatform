import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { clearDocumentFlowData } from '../../../test/support/test-database-cleanup';
import { FakeModelCatalog, FAKE_PLAN_MODEL_ID } from '../../test-support/fake-model-catalog';
import { FakeStorageVerifier } from '../../test-support/fake-storage-verifier';
import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';
import { AiIngestionService } from '../ai/ai-ingestion.service';
import { AiOutboxEvent } from '../ai/entities/ai-outbox-event.entity';
import { ProcessingJob } from '../ai/entities/processing-job.entity';
import { AiOutboxRepository } from '../ai/repositories/ai-outbox.repository';
import { ProcessingJobRepository } from '../ai/repositories/processing-job.repository';
import {
  DOCUMENT_EXTRACTION_COMPLETED_EVENT,
  DocumentProcessingFailureCode,
} from '../ai/contracts/document-processing-result';
import type { QuizGenerationHandoffPort } from '../assessment/contracts/quiz-generation-handoff.contract';
import { ReturnRelay } from '../../worker/return-relay.service';
import { ContentService } from './content.service';
import { MediaCreditEstimator } from './credit-estimation/media-credit-estimator';
import { DocumentStatusProjectionService } from './document-status-projection.service';
import { Document } from './entities/document.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentType } from './enums/document-type.enum';
import { ForwardRelay } from './forward-relay.service';
import { ContentRepository } from './repositories/content.repository';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';

const WALLET_CREDITS = 10_000;
const GO_QUEUE_ATTEMPT = 3;
const CHUNK_COUNT = 2;
const EXTRACTED_CHARS = 3000;
/** 2 chunks * 200 prompt + ceil(3000 / 3) = 1400 input; 2 chunks * 600 = 1200 output at 2 credits each. */
const EXPECTED_ESTIMATE = 1400 + 2400;
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

describe('PDF/TXT credit reservation after extraction (#281, ADR-0033)', () => {
  let db: TestDb;
  let ds: DataSource;
  let documents: Repository<Document>;
  let courseOutbox: Repository<OutboxEvent>;
  let aiOutbox: Repository<AiOutboxEvent>;
  let jobs: Repository<ProcessingJob>;
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
    jobs = ds.getRepository(ProcessingJob);
    service = new ContentService(
      new ContentRepository(ds),
      { getBucketName: () => 'documents' } as never,
      new FakeStorageVerifier(),
      null as never,
      new FakeModelCatalog(),
    );
    await clearDocumentFlowData(db.client);
  });

  async function seedDocument(ownerId: string, overrides: Partial<Document> = {}): Promise<Document> {
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

  async function readRequestJobTypes(documentId: string): Promise<string[]> {
    const rows = await courseOutbox.find({ where: { aggregateId: documentId }, order: { createdAt: 'ASC' } });
    return rows.map((row) => String((row.payload as { jobType: string }).jobType));
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

  const createForwardRelay = (): ForwardRelay => new ForwardRelay(
    new CourseOutboxRepository(ds),
    new ContentRepository(ds),
    new AiIngestionService(new ProcessingJobRepository(ds)),
  );

  async function seedExtraction(document: Document, overrides: Record<string, unknown> = {}): Promise<void> {
    await aiOutbox.save(aiOutbox.create({
      aggregateId: randomUUID(),
      eventType: DOCUMENT_EXTRACTION_COMPLETED_EVENT,
      payload: {
        attempt: GO_QUEUE_ATTEMPT,
        chunkCount: CHUNK_COUNT,
        deletionFence: Number(document.deletionFence),
        documentId: document.id,
        extractedChars: EXTRACTED_CHARS,
        fullPipelineJobId: document.fullPipelineJobId,
        leaseId: randomUUID(),
        ownerId: document.ownerId,
        processingAttempt: Number(document.processingAttempt),
        version: 1,
        ...overrides,
      },
    }));
  }

  async function seedResult(
    document: Document,
    overrides: Record<string, unknown>,
    aggregateId: string = document.fullPipelineJobId,
  ): Promise<void> {
    await aiOutbox.save(aiOutbox.create({
      aggregateId,
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

  /** Confirm, let Go "finish" the extraction and let the return seam reserve; returns the reloaded Document. */
  async function confirmAndExtract(ownerId: string): Promise<Document> {
    const inputDocument = await seedDocument(ownerId);
    await service.confirm(ownerId, inputDocument.id);
    const confirmed = await documents.findOneByOrFail({ id: inputDocument.id });
    await seedExtraction(confirmed);
    await createRelay().pump(10);
    return documents.findOneByOrFail({ id: inputDocument.id });
  }

  describe('confirm and retry', () => {
    it('reserves nothing at confirm and only queues the extraction', async () => {
      const inputOwnerId = randomUUID();
      const inputDocument = await seedDocument(inputOwnerId);
      await seedWallet(inputOwnerId);

      const actualDocument = await service.confirm(inputOwnerId, inputDocument.id);

      const reloaded = await documents.findOneByOrFail({ id: inputDocument.id });
      expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await readWallet(inputOwnerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
      expect(reloaded.budgetStatus).toBeNull();
      expect(await readRequestJobTypes(inputDocument.id)).toEqual(['TEXT_EXTRACT']);
    });

    it('does not depend on the file size: a wallet below the old coarse estimate (768 for 1 KiB) can still start', async () => {
      const inputOwnerId = randomUUID();
      const inputDocument = await seedDocument(inputOwnerId);
      await seedWallet(inputOwnerId, 100);

      const actualDocument = await service.confirm(inputOwnerId, inputDocument.id);

      expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
      expect(await readLedger(inputOwnerId)).toEqual({});
    });

    it.each([
      { name: 'an empty wallet', availableCredits: 0 },
      { name: 'no wallet row', availableCredits: null },
    ])('rejects confirm with 402 INSUFFICIENT_CREDITS for $name and changes nothing', async ({ availableCredits }) => {
      const inputOwnerId = randomUUID();
      const inputDocument = await seedDocument(inputOwnerId);
      if (availableCredits !== null) await seedWallet(inputOwnerId, availableCredits);

      const actualError = await service.confirm(inputOwnerId, inputDocument.id).catch((error: unknown) => error);

      expect(actualError).toMatchObject({
        response: { availableCredits: 0, code: 'INSUFFICIENT_CREDITS', requiredCredits: 1, shortfallCredits: 1 },
        status: 402,
      });
      const reloaded = await documents.findOneByOrFail({ id: inputDocument.id });
      expect(reloaded.status).toBe(DocumentStatus.UPLOADED);
      expect(reloaded.processingAttempt).toBe(inputDocument.processingAttempt);
      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await courseOutbox.count({ where: { aggregateId: inputDocument.id } })).toBe(0);
    });

    it('queues one extraction for replayed or concurrent confirms', async () => {
      const inputOwnerId = randomUUID();
      const inputDocument = await seedDocument(inputOwnerId);
      await seedWallet(inputOwnerId);

      await Promise.all([
        service.confirm(inputOwnerId, inputDocument.id),
        service.confirm(inputOwnerId, inputDocument.id),
      ]);
      await service.confirm(inputOwnerId, inputDocument.id);

      expect(await readRequestJobTypes(inputDocument.id)).toEqual(['TEXT_EXTRACT']);
      expect(await readLedger(inputOwnerId)).toEqual({});
    });

    it('creates the TEXT_EXTRACT job through the forward relay with the identity Node needs to reserve', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      const confirmed = await documents.findOneByOrFail({ id: inputDocument.id });

      await createForwardRelay().pump(10);
      await createForwardRelay().pump(10);

      const actualJobs = await jobs.find({ where: { documentId: inputDocument.id } });
      expect(actualJobs).toHaveLength(1);
      expect(actualJobs[0]).toMatchObject({
        attempts: Number(confirmed.processingAttempt) - 1,
        fullPipelineJobId: confirmed.fullPipelineJobId,
        jobType: 'TEXT_EXTRACT',
        processingAttempt: Number(confirmed.processingAttempt),
        status: 'PENDING',
      });
    });
  });

  describe('reservation from the extracted text', () => {
    it('reserves the priced text once and queues the full pipeline under the same attempt key', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);

      const actualDocument = await confirmAndExtract(inputOwnerId);

      const expectedKey = `reserve:${actualDocument.fullPipelineJobId}:${actualDocument.processingAttempt}`;
      expect(await readLedger(inputOwnerId)).toEqual({ [expectedKey]: String(EXPECTED_ESTIMATE) });
      expect(await readWallet(inputOwnerId)).toEqual({
        available_credits: String(WALLET_CREDITS - EXPECTED_ESTIMATE),
        reserved_credits: String(EXPECTED_ESTIMATE),
      });
      expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
      expect(actualDocument.budgetStatus).toBe('RESERVED');
      expect(Number(actualDocument.estimatedCredits)).toBe(EXPECTED_ESTIMATE);
      expect(await readRequestJobTypes(actualDocument.id)).toEqual(['TEXT_EXTRACT', 'FULL_PIPELINE']);
    });

    it('does not reserve or queue twice when the extraction event is replayed', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const actualDocument = await confirmAndExtract(inputOwnerId);

      await seedExtraction(actualDocument);
      await createRelay().pump(10);

      expect(Object.keys(await readLedger(inputOwnerId))).toHaveLength(1);
      expect((await readWallet(inputOwnerId)).reserved_credits).toBe(String(EXPECTED_ESTIMATE));
      expect(await readRequestJobTypes(actualDocument.id)).toEqual(['TEXT_EXTRACT', 'FULL_PIPELINE']);
    });

    it('does not reserve twice for concurrent duplicates of the extraction event', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      const confirmed = await documents.findOneByOrFail({ id: inputDocument.id });
      await seedExtraction(confirmed);
      await seedExtraction(confirmed);

      await Promise.all([createRelay().pump(10), createRelay().pump(10)]);

      expect(Object.keys(await readLedger(inputOwnerId))).toHaveLength(1);
      expect(await readRequestJobTypes(inputDocument.id)).toEqual(['TEXT_EXTRACT', 'FULL_PIPELINE']);
    });

    it('fails with INSUFFICIENT_CREDITS_AFTER_EXTRACT when the wallet cannot cover the real text, reserving nothing', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId, 100);

      const actualDocument = await confirmAndExtract(inputOwnerId);

      expect(actualDocument.status).toBe(DocumentStatus.FAILED);
      expect(actualDocument.errorCode).toBe(DocumentProcessingFailureCode.INSUFFICIENT_CREDITS_AFTER_EXTRACT);
      expect(actualDocument.errorMessage).toBe(
        'Tài liệu cần khoảng 3.800 credit để tạo câu hỏi nhưng bạn chỉ còn 100 credit. Hãy bổ sung credit rồi thử lại.',
      );
      expect(actualDocument.budgetStatus).toBe('NOT_RESERVED');
      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await readWallet(inputOwnerId)).toEqual({ available_credits: '100', reserved_credits: '0' });
      // No FULL_PIPELINE request exists, so no provider call can happen for this attempt.
      expect(await readRequestJobTypes(actualDocument.id)).toEqual(['TEXT_EXTRACT']);
      await createForwardRelay().pump(10);
      expect(await jobs.find({ where: { documentId: actualDocument.id, jobType: 'FULL_PIPELINE' as never } })).toHaveLength(0);
    });

    it('can retry after a top-up under a new attempt key and reserve again', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId, 100);
      const failed = await confirmAndExtract(inputOwnerId);
      await db.client.query(
        'UPDATE "course"."owner_credit_wallets" SET "available_credits" = $2 WHERE "owner_id" = $1',
        [inputOwnerId, WALLET_CREDITS],
      );

      const retried = await service.retry(inputOwnerId, failed.id);
      await seedExtraction(retried);
      await createRelay().pump(10);

      const actualDocument = await documents.findOneByOrFail({ id: failed.id });
      expect(Number(retried.processingAttempt)).toBe(Number(failed.processingAttempt) + 1);
      expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
      expect(await readLedger(inputOwnerId)).toEqual({
        [`reserve:${actualDocument.fullPipelineJobId}:${actualDocument.processingAttempt}`]: String(EXPECTED_ESTIMATE),
      });
    });

    it('ignores a stale extraction of an older attempt', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId, 100);
      const failed = await confirmAndExtract(inputOwnerId);
      await db.client.query(
        'UPDATE "course"."owner_credit_wallets" SET "available_credits" = $2 WHERE "owner_id" = $1',
        [inputOwnerId, WALLET_CREDITS],
      );
      const retried = await service.retry(inputOwnerId, failed.id);

      await seedExtraction(failed);
      await createRelay().pump(10);

      const actualDocument = await documents.findOneByOrFail({ id: failed.id });
      expect(actualDocument.processingAttempt).toBe(retried.processingAttempt);
      expect(actualDocument.status).toBe(DocumentStatus.PROCESSING);
      expect(await readLedger(inputOwnerId)).toEqual({});
    });

    it('fails the Document without reserving when the platform model is no longer configured', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      await seedExtraction(await documents.findOneByOrFail({ id: inputDocument.id }));
      const relayWithoutModels = new ReturnRelay(
        new AiOutboxRepository(ds),
        new DocumentStatusProjectionService(
          new ContentRepository(ds),
          { ai: { platformModels: [] } } as never,
          new MediaCreditEstimator(),
        ),
        quizHandoff,
      );

      await relayWithoutModels.pump(10);

      const actualDocument = await documents.findOneByOrFail({ id: inputDocument.id });
      expect(actualDocument.status).toBe(DocumentStatus.FAILED);
      expect(actualDocument.errorCode).toBe(DocumentProcessingFailureCode.PROCESSING_FAILED);
      expect(await readLedger(inputOwnerId)).toEqual({});
    });

    it('rejects a malformed extraction payload without publishing it', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      await seedExtraction(await documents.findOneByOrFail({ id: inputDocument.id }), { chunkCount: 0 });

      await expect(createRelay().pump(10)).rejects.toThrow('Invalid document extraction completion outbox payload');

      const pending = await aiOutbox.find({ where: { eventType: DOCUMENT_EXTRACTION_COMPLETED_EVENT } });
      expect(pending[0]?.publishedAt).toBeNull();
      expect(await readLedger(inputOwnerId)).toEqual({});
    });
  });

  describe('settlement after the reservation', () => {
    it('settles actual usage and releases the remainder when the PDF is READY through the return relay', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const reserved = await confirmAndExtract(inputOwnerId);
      await seedResult(reserved, {
        usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
      });

      await createRelay().pump(10);

      // 100 input * 1 + 20 output * 2 = 140 credits used.
      const suffix = `${reserved.fullPipelineJobId}:${Number(reserved.processingAttempt)}`;
      expect(await readLedger(inputOwnerId)).toEqual({
        [`reserve:${suffix}`]: String(EXPECTED_ESTIMATE),
        [`settle:${suffix}`]: '140',
        [`release:${suffix}`]: String(EXPECTED_ESTIMATE - 140),
      });
      expect(await readWallet(inputOwnerId)).toEqual({
        available_credits: String(WALLET_CREDITS - 140),
        reserved_credits: '0',
      });
      const projected = await documents.findOneByOrFail({ id: reserved.id });
      expect(projected.status).toBe(DocumentStatus.READY);
      expect(projected.budgetStatus).toBe('SETTLED');
    });

    it('keeps an uncertain provider dispatch HELD', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const reserved = await confirmAndExtract(inputOwnerId);
      await seedResult(reserved, {
        errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
        status: DocumentStatus.FAILED,
        usage: { llm: [], uncertainDispatches: 1 },
      });

      await createRelay().pump(10);

      const suffix = `${reserved.fullPipelineJobId}:${Number(reserved.processingAttempt)}`;
      expect(Object.keys(await readLedger(inputOwnerId))).toEqual(
        expect.arrayContaining([`reserve:${suffix}`, `settle:${suffix}`, `hold:${suffix}`]),
      );
      expect((await documents.findOneByOrFail({ id: reserved.id })).budgetStatus).toBe('HELD');
    });

    it('keeps a FULL_PIPELINE job queued before the rollout sane: no reservation means settlement is a no-op', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId, { processingAttempt: 1, status: DocumentStatus.PROCESSING });
      await seedResult(inputDocument, {
        usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
      });

      await createRelay().pump(10);

      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await readWallet(inputOwnerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
      expect((await documents.findOneByOrFail({ id: inputDocument.id })).status).toBe(DocumentStatus.READY);
    });

    it('fails the Document without credit side effects or a settlement warning when the extraction job itself fails', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      const confirmed = await documents.findOneByOrFail({ id: inputDocument.id });
      // A TEXT_EXTRACT job has its own id, different from the Document's fullPipelineJobId.
      await seedResult(confirmed, {
        errorCode: DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND,
        jobType: 'TEXT_EXTRACT',
        status: DocumentStatus.FAILED,
      }, randomUUID());
      const warn = jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);

      await createRelay().pump(10);

      const settlementWarnings = warn.mock.calls.filter(([message]) =>
        (message as { event?: string }).event === 'content.settlement.skipped');
      warn.mockRestore();
      const actualDocument = await documents.findOneByOrFail({ id: inputDocument.id });
      expect(settlementWarnings).toHaveLength(0);
      expect(actualDocument.status).toBe(DocumentStatus.FAILED);
      expect(actualDocument.errorCode).toBe(DocumentProcessingFailureCode.PDF_TEXT_NOT_FOUND);
      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await readWallet(inputOwnerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
    });

    it('still warns for a stale FULL_PIPELINE result whose job id is not the Document pipeline job', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const reserved = await confirmAndExtract(inputOwnerId);
      const staleJobId = randomUUID();
      await seedResult(reserved, { usage: { llm: [], uncertainDispatches: 0 } }, staleJobId);
      const warn = jest.spyOn(ConsoleLogger.prototype, 'warn').mockImplementation(() => undefined);

      await createRelay().pump(10);

      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'content.settlement.skipped',
        eventJobId: staleJobId,
        reason: 'job_id_mismatch',
      }));
      warn.mockRestore();
    });

    it('logs the measurement and estimate at reservation time so calibration can join them with the actual usage', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const log = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);

      const reserved = await confirmAndExtract(inputOwnerId);
      await seedResult(reserved, {
        usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
      });
      await createRelay().pump(10);

      const events = log.mock.calls.map(([message]) => message as Record<string, unknown>);
      log.mockRestore();
      expect(events).toContainEqual(expect.objectContaining({
        chunkCount: CHUNK_COUNT,
        documentId: reserved.id,
        estimatedCredits: EXPECTED_ESTIMATE,
        event: 'content.extraction.credit_estimated',
        extractedChars: EXTRACTED_CHARS,
        jobId: reserved.fullPipelineJobId,
        model: 'gpt-5.4-mini',
      }));
      expect(events).toContainEqual(expect.objectContaining({
        documentId: reserved.id,
        event: 'content.settlement.actual_usage',
        inputTokens: 100,
        jobId: reserved.fullPipelineJobId,
        outputTokens: 20,
      }));
    });
  });

  describe('Document deleted while processing', () => {
    const buckets = { documents: 'learning-platform-dev-documents', media: 'learning-platform-dev-media' };

    async function reserveThenDelete(): Promise<Document> {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const reserved = await confirmAndExtract(inputOwnerId);
      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, reserved.id, buckets);
      return reserved;
    }

    it('reserves nothing for an extraction that finishes after the Document was deleted', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      const confirmed = await documents.findOneByOrFail({ id: inputDocument.id });
      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, inputDocument.id, buckets);
      await seedExtraction(confirmed);

      await createRelay().pump(10);

      expect(await readLedger(inputOwnerId)).toEqual({});
      expect(await readWallet(inputOwnerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
      expect((await documents.findOneByOrFail({ id: inputDocument.id })).status).toBe(DocumentStatus.DELETING);
      expect(await readRequestJobTypes(inputDocument.id)).not.toContain('FULL_PIPELINE');
    });

    it('cancels a running TEXT_EXTRACT job in the deletion transaction and leaves a placeholder per job type', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      await createForwardRelay().pump(10);
      await db.client.query(
        `UPDATE "ai"."processing_jobs" SET "status" = 'RUNNING', "lease_id" = gen_random_uuid(), "lease_until" = now() + interval '5 minutes' WHERE "document_id" = $1`,
        [inputDocument.id],
      );

      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, inputDocument.id, buckets);

      const actualJobs = await jobs.find({ where: { documentId: inputDocument.id } });
      expect(actualJobs.map((job) => `${job.jobType}:${job.status}`).sort()).toEqual([
        'FULL_PIPELINE:CANCELLED',
        'TEXT_EXTRACT:CANCELLED',
      ]);
      expect(actualJobs.find((job) => job.jobType === ('TEXT_EXTRACT' as never))).toMatchObject({
        leaseId: null,
        leaseUntil: null,
      });
    });

    it('leaves placeholders for both job types when the Document is deleted before the forward relay ran', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);

      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, inputDocument.id, buckets);
      await createForwardRelay().pump(10);

      const actualJobs = await jobs.find({ where: { documentId: inputDocument.id } });
      expect(actualJobs.map((job) => `${job.jobType}:${job.status}`).sort()).toEqual([
        'FULL_PIPELINE:CANCELLED',
        'TEXT_EXTRACT:CANCELLED',
      ]);
    });

    it('cancels the AI jobs on deletion so a stale forward event cannot re-arm the extraction', async () => {
      const inputOwnerId = randomUUID();
      await seedWallet(inputOwnerId);
      const inputDocument = await seedDocument(inputOwnerId);
      await service.confirm(inputOwnerId, inputDocument.id);
      await createForwardRelay().pump(10);
      await new ContentRepository(ds).deleteOwnedDocument(inputOwnerId, inputDocument.id, buckets);

      await createForwardRelay().pump(10);

      const actualJobs = await jobs.find({ where: { documentId: inputDocument.id } });
      expect(actualJobs.map((job) => `${job.jobType}:${job.status}`).sort()).toEqual([
        'FULL_PIPELINE:CANCELLED',
        'TEXT_EXTRACT:CANCELLED',
      ]);
    });

    it('settles actual usage and releases the rest on READY while the Document stays DELETING', async () => {
      const reserved = await reserveThenDelete();
      await seedResult(reserved, {
        usage: { llm: [{ inputTokens: 100, model: 'gpt-5.4-mini', outputTokens: 20 }], uncertainDispatches: 0 },
      });

      await createRelay().pump(10);

      const suffix = `${reserved.fullPipelineJobId}:${Number(reserved.processingAttempt)}`;
      expect(await readLedger(reserved.ownerId)).toEqual({
        [`reserve:${suffix}`]: String(EXPECTED_ESTIMATE),
        [`settle:${suffix}`]: '140',
        [`release:${suffix}`]: String(EXPECTED_ESTIMATE - 140),
      });
      expect(await readWallet(reserved.ownerId)).toEqual({
        available_credits: String(WALLET_CREDITS - 140),
        reserved_credits: '0',
      });
      expect((await documents.findOneByOrFail({ id: reserved.id })).status).toBe(DocumentStatus.DELETING);
    });

    it('releases everything on a FAILED result before any provider call and stays idempotent on replay', async () => {
      const reserved = await reserveThenDelete();
      const failedPayload = {
        errorCode: DocumentProcessingFailureCode.EXTRACTION_OBJECT_NOT_FOUND,
        status: DocumentStatus.FAILED,
        usage: { llm: [], uncertainDispatches: 0 },
      };
      await seedResult(reserved, failedPayload);
      await seedResult(reserved, failedPayload);

      await createRelay().pump(10);

      expect(await readWallet(reserved.ownerId)).toEqual({ available_credits: String(WALLET_CREDITS), reserved_credits: '0' });
      expect(Object.keys(await readLedger(reserved.ownerId))).toHaveLength(3);
      expect((await documents.findOneByOrFail({ id: reserved.id })).status).toBe(DocumentStatus.DELETING);
    });

    it('skips without failing when the Document row is already gone', async () => {
      const reserved = await reserveThenDelete();
      await db.client.query('DELETE FROM "course"."documents" WHERE "id" = $1', [reserved.id]);
      await seedResult(reserved, { usage: { llm: [], uncertainDispatches: 0 } });

      await createRelay().pump(10);

      expect((await readWallet(reserved.ownerId)).reserved_credits).toBe(String(EXPECTED_ESTIMATE));
      expect((await aiOutbox.find({ where: { aggregateId: reserved.fullPipelineJobId } }))[0]?.publishedAt).not.toBeNull();
    });
  });
});
