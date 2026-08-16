import { randomUUID } from 'crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { AiOutboxEvent } from '../modules/ai/entities/ai-outbox-event.entity';
import { DocumentProcessingFailureCode } from '../modules/ai/contracts/document-processing-result';
import { AiOutboxRepository } from '../modules/ai/repositories/ai-outbox.repository';
import {
  DocumentStatusProjection,
  DocumentStatusProjectionCommand,
} from '../modules/content/contracts/document-status-projection.port';
import { DocumentStatusProjectionService } from '../modules/content/document-status-projection.service';
import { Document } from '../modules/content/entities/document.entity';
import { DocumentStatus } from '../modules/content/enums/document-status.enum';
import { DocumentType } from '../modules/content/enums/document-type.enum';
import { ContentRepository } from '../modules/content/repositories/content.repository';
import { createTestDataSource } from '../test-support/test-data-source';
import { startTestDb, TestDb } from '../test-support/test-db';
import { ReturnRelay } from './return-relay.service';

const quizHandoff = { persist: async () => ({ optionCount: 0, questionCount: 0, questionIds: [], quizId: randomUUID() }) };

describe('ReturnRelay', () => {
  let db: TestDb;
  let ds: DataSource;
  let documents: Repository<Document>;
  let outbox: Repository<AiOutboxEvent>;
  let relay: ReturnRelay;

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
    relay = new ReturnRelay(
      new AiOutboxRepository(ds),
      new DocumentStatusProjectionService(new ContentRepository(ds)),
      quizHandoff,
    );
    await db.client.query('TRUNCATE "ai"."outbox", "course"."documents"');
  });

  async function seedProcessingDocument(ownerId = randomUUID()): Promise<Document> {
    return documents.save(
      documents.create({
        ownerId,
        originalName: 'lecture.pdf',
        sizeBytes: 100,
        status: DocumentStatus.PROCESSING,
        storageRef: `documents/${randomUUID()}.pdf`,
        type: DocumentType.PDF,
      }),
    );
  }

  async function seedResult(
    document: Document,
    status: DocumentStatus.READY | DocumentStatus.FAILED,
    ownerId = document.ownerId,
  ): Promise<AiOutboxEvent> {
    return outbox.save(
      outbox.create({
        aggregateId: randomUUID(),
        eventType: 'DocumentProcessingResult',
        payload: {
          documentId: document.id,
          budgetStatus: status === DocumentStatus.FAILED ? 'EXHAUSTED' : 'SETTLED',
          estimatedCredits: 100,
          estimateStatus: 'AUTHORITATIVE',
          errorCode: null,
          errorMessage: status === DocumentStatus.FAILED ? 'Processing failed' : null,
          ownerId,
          settledCredits: status === DocumentStatus.FAILED ? 0 : 25,
          status,
          version: 1,
        },
      }),
    );
  }

  it('idempotently projects READY then marks ai outbox published', async () => {
    const document = await seedProcessingDocument();
    const event = await seedResult(document, DocumentStatus.READY);
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);

    await relay.pump(10);
    await relay.pump(10);

    expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(
      DocumentStatus.READY,
    );
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
    expect((await documents.findOneByOrFail({ id: document.id })).budgetStatus).toBe('SETTLED');
    expect((await documents.findOneByOrFail({ id: document.id })).estimateStatus).toBe('AUTHORITATIVE');
    expect((await documents.findOneByOrFail({ id: document.id })).estimatedCredits).toBe('100');
    expect((await documents.findOneByOrFail({ id: document.id })).settledCredits).toBe('25');
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      documentId: document.id,
      durationMs: expect.any(Number),
      event: 'ai.job.return.projected',
      jobId: event.aggregateId,
      projectionDurationMs: expect.any(Number),
      publishDurationMs: expect.any(Number),
      queueWaitMs: expect.any(Number),
      runtime: 'worker',
    }));
    logger.mockRestore();
  });

  it('idempotently projects FAILED after a projection failure retry', async () => {
    const document = await seedProcessingDocument();
    const event = await seedResult(document, DocumentStatus.FAILED);
    const failingProjection: DocumentStatusProjection = {
      project: async (_command: DocumentStatusProjectionCommand) => {
        throw new Error('content unavailable');
      },
    };
    const failingRelay = new ReturnRelay(new AiOutboxRepository(ds), failingProjection, quizHandoff);

    await expect(failingRelay.pump(10)).rejects.toThrow('content unavailable');
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).toBeNull();

    await relay.pump(10);
    await relay.pump(10);

    const projected = await documents.findOneByOrFail({ id: document.id });
    expect(projected.status).toBe(DocumentStatus.FAILED);
    expect(projected.errorMessage).toBe('Processing failed');
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('publishes and idempotently projects a failed PDF extraction result', async () => {
    const document = await seedProcessingDocument();
    const event = await outbox.save(
      outbox.create({
        aggregateId: randomUUID(),
        eventType: 'DocumentProcessingResult',
        payload: {
          documentId: document.id,
          errorCode: 'PDF_TEXT_NOT_FOUND',
          errorMessage: 'The uploaded PDF does not contain extractable text.',
          ownerId: document.ownerId,
          status: DocumentStatus.FAILED,
          version: 1,
        },
      }),
    );

    await relay.pump(10);
    await relay.pump(10);

    const projected = await documents.findOneByOrFail({ id: document.id });
    expect(projected.status).toBe(DocumentStatus.FAILED);
    expect(projected.errorMessage).toBe(
      'The uploaded PDF does not contain extractable text.',
    );
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('clears a failed document error code and message when it is reconfirmed', async () => {
    const document = await seedProcessingDocument();
    await documents.update(
      { id: document.id },
      {
        errorCode: DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE,
        errorMessage: 'Document processing is temporarily unavailable. Please try again later.',
        status: DocumentStatus.FAILED,
      },
    );

    await new ContentRepository(ds).confirmProcessing(document.ownerId, document.id, {
      customModelConfigId: null,
      kind: 'PLAN',
      platformModelId: null,
    });

    const reconfirmed = await documents.findOneByOrFail({ id: document.id });
    expect(reconfirmed.status).toBe(DocumentStatus.PROCESSING);
    expect(reconfirmed.errorCode).toBeNull();
    expect(reconfirmed.errorMessage).toBeNull();
  });

  it('preserves the Course coarse estimate when a legacy result has no authoritative estimate', async () => {
    const document = await documents.save(documents.create({
      ownerId: randomUUID(),
      originalName: 'lecture.pdf',
      sizeBytes: 100,
      status: DocumentStatus.PROCESSING,
      storageRef: `documents/${randomUUID()}.pdf`,
      type: DocumentType.PDF,
      budgetStatus: 'CUSTOM_ZERO_COST',
      estimatedCredits: 0,
      estimateStatus: 'COARSE',
    }));
    await outbox.save(outbox.create({
      aggregateId: randomUUID(),
      eventType: 'DocumentProcessingResult',
      payload: {
        documentId: document.id,
        errorCode: null,
        errorMessage: null,
        ownerId: document.ownerId,
        status: DocumentStatus.READY,
        version: 1,
      },
    }));

    await relay.pump(10);

    const projected = await documents.findOneByOrFail({ id: document.id });
    expect(projected.budgetStatus).toBe('CUSTOM_ZERO_COST');
    expect(projected.estimatedCredits).toBe('0');
    expect(projected.estimateStatus).toBe('COARSE');
    expect(projected.status).toBe(DocumentStatus.READY);
  });

  it('accepts the safe chunk resource-limit failure code', async () => {
    const document = await seedProcessingDocument();
    const event = await outbox.save(outbox.create({
      aggregateId: randomUUID(),
      eventType: 'DocumentProcessingResult',
      payload: {
        documentId: document.id,
        errorCode: 'CHUNK_RESOURCE_LIMIT_EXCEEDED',
        errorMessage: 'Document exceeds configured chunk processing limits',
        ownerId: document.ownerId,
        status: DocumentStatus.FAILED,
        version: 1,
      },
    }));

    await relay.pump(10);

    expect((await documents.findOneByOrFail({ id: document.id })).errorMessage).toBe(
      'Document exceeds configured chunk processing limits',
    );
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it.each([
    ['GENERATION_OUTPUT_INVALID', 'Generated question output is invalid'],
    ['GENERATION_OUTPUT_TRUNCATED', 'Generated question output was truncated. Please try again later.'],
    ['INSUFFICIENT_VALID_QUESTIONS', 'Not enough valid questions were generated'],
    ['PROVIDER_UNAVAILABLE', 'Document processing is temporarily unavailable. Please try again later.'],
  ])('accepts the safe generation failure code %s', async (errorCode, errorMessage) => {
    const document = await seedProcessingDocument();
    const event = await outbox.save(outbox.create({
      aggregateId: randomUUID(),
      eventType: 'DocumentProcessingResult',
      payload: {
        documentId: document.id,
        errorCode,
        errorMessage,
        ownerId: document.ownerId,
        status: DocumentStatus.FAILED,
        version: 1,
      },
    }));

    await relay.pump(10);

    const projected = await documents.findOneByOrFail({ id: document.id });
    expect(projected.errorCode).toBe(errorCode);
    expect(projected.errorMessage).toBe(errorMessage);
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('does not project a result for another owner', async () => {
    const document = await seedProcessingDocument();
    const event = await seedResult(document, DocumentStatus.READY, randomUUID());

    await relay.pump(10);

    expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(
      DocumentStatus.PROCESSING,
    );
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('keeps a different event type from starving the bounded result relay', async () => {
    const document = await seedProcessingDocument();
    const unrelated = await outbox.save(
      outbox.create({
        aggregateId: randomUUID(),
        eventType: 'FutureAiEvent',
        payload: {},
      }),
    );
    const result = await seedResult(document, DocumentStatus.READY);

    await relay.pump(1);

    expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(
      DocumentStatus.READY,
    );
    expect((await outbox.findOneByOrFail({ id: result.id })).publishedAt).not.toBeNull();
    expect((await outbox.findOneByOrFail({ id: unrelated.id })).publishedAt).toBeNull();
  });
});
