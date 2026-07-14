import { randomUUID } from 'crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { AiOutboxEvent } from '../modules/ai/entities/ai-outbox-event.entity';
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
          errorCode: null,
          errorMessage: status === DocumentStatus.FAILED ? 'Processing failed' : null,
          ownerId,
          status,
          version: 1,
        },
      }),
    );
  }

  it('projects READY then marks ai outbox published', async () => {
    const document = await seedProcessingDocument();
    const event = await seedResult(document, DocumentStatus.READY);

    await relay.pump(10);

    expect((await documents.findOneByOrFail({ id: document.id })).status).toBe(
      DocumentStatus.READY,
    );
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).not.toBeNull();
  });

  it('retries idempotently after a projection failure', async () => {
    const document = await seedProcessingDocument();
    const event = await seedResult(document, DocumentStatus.FAILED);
    const failingProjection: DocumentStatusProjection = {
      project: async (_command: DocumentStatusProjectionCommand) => {
        throw new Error('content unavailable');
      },
    };
    const failingRelay = new ReturnRelay(new AiOutboxRepository(ds), failingProjection);

    await expect(failingRelay.pump(10)).rejects.toThrow('content unavailable');
    expect((await outbox.findOneByOrFail({ id: event.id })).publishedAt).toBeNull();

    await relay.pump(10);
    await relay.pump(10);

    const projected = await documents.findOneByOrFail({ id: document.id });
    expect(projected.status).toBe(DocumentStatus.FAILED);
    expect(projected.errorMessage).toBe('Processing failed');
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
