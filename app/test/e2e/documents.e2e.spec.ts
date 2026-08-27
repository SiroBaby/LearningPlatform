import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { Document } from '../../src/modules/content/entities/document.entity';
import { STORAGE_VERIFIER } from '../../src/storage/contracts/storage-verifier.port';
import { StorageService } from '../../src/storage/storage.service';
import { PDF_JS_MODULE } from '../../src/modules/ai/extraction.service';
import { startTestDb, TestDb } from '../../src/test-support/test-db';
import {
  pdfJsWithText,
  TestStorageServer,
} from '../support/document-flow-test-doubles';

describe('Document HTTP flow', () => {
  let db: TestDb;
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: TestStorageServer;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();

  beforeAll(async () => {
    // AppModule eagerly constructs the OAuth provider; e2e uses the legacy
    // owner-header seam, so provide non-secret fixture values for bootstrap.
    process.env.GOOGLE_CLIENT_ID ??= 'e2e-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET ??= 'e2e-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3000/auth/google/callback';
    process.env.AUTH_OAUTH_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
    db = await startTestDb();
    storage = await TestStorageServer.start();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue({
        createPresignedPostUrl: (
          objectKey: string,
          _contentType: string,
          _sizeBytes: number,
        ) => storage.createUploadForm(objectKey),
        getBucketName: () => 'documents',
      })
      .overrideProvider(STORAGE_VERIFIER)
      .useValue(storage)
      .overrideProvider(PDF_JS_MODULE)
      .useValue(pdfJsWithText('Chunkable lecture content'))
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
    await storage?.stop();
    await db?.stop();
  });

  beforeEach(async () => {
    await db.client.query(
      'TRUNCATE "quiz"."options", "quiz"."questions", "quiz"."quizzes", "ai"."generation_cache", "ai"."prompt_versions", "course"."documents", "course"."outbox", "ai"."outbox", "ai"."processing_jobs", "ai"."chunks" CASCADE',
    );
  });

  it('creates, confirms and exposes an owned document through HTTP', async () => {
    const estimate = await request('/api/v1/documents/estimate', {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(estimate.status).toBe(200);
    expect(await estimate.json()).toEqual({
      estimatedCredits: 518,
      precision: 'COARSE',
      selectedModelKind: 'PLAN',
      selectedModelLabel: 'Fast platform model',
    });
    expect(await dataSource.getRepository(Document).count()).toBe(0);
    expect(await dataSource.query('SELECT count(*)::int AS "count" FROM "course"."credit_ledger_entries"')).toEqual([{ count: 0 }]);

    const created = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({
        originalName: 'lecture.pdf',
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(created.status).toBe(201);
    const upload = (await created.json()) as {
      documentId: string;
      uploadFields: Record<string, string>;
      uploadUrl: string;
    };
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.uploadFields)) form.set(key, value);
    form.set('file', new Blob([Buffer.from('%PDF-1.4\n% e2e upload\n')]), 'lecture.pdf');
    const uploadResponse = await fetch(upload.uploadUrl, { method: 'POST', body: form });
    expect(uploadResponse.status).toBe(200);

    const confirmed = await request(
      `/api/v1/documents/${upload.documentId}/confirm`,
      { method: 'POST', headers: ownerHeaders() },
    );
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({
      documentId: upload.documentId,
      status: 'PROCESSING',
    });

    const fetched = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: ownerHeaders(),
    });
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({
      id: upload.documentId,
      status: 'PROCESSING',
      sizeBytes: 22,
    });

    const newerCreated = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({
        originalName: 'newer-lecture.pdf',
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(newerCreated.status).toBe(201);
    const newerUpload = await newerCreated.json() as { readonly documentId: string };

    const listed = await request('/api/v1/documents', {
      headers: ownerHeaders(),
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        id: newerUpload.documentId,
        status: 'UPLOADED',
      }),
      expect.objectContaining({
        id: upload.documentId,
        status: 'PROCESSING',
      }),
    ]);

    const hiddenList = await request('/api/v1/documents', {
      headers: ownerHeaders(otherOwnerId),
    });
    expect(hiddenList.status).toBe(200);
    expect(await hiddenList.json()).toEqual([]);

    const absentQuiz = await request(`/api/v1/documents/${newerUpload.documentId}/quiz`, {
      headers: ownerHeaders(),
    });
    expect(absentQuiz.status).toBe(409);
    expect(await absentQuiz.json()).toEqual({
      code: 'QUIZ_NOT_READY',
      message: 'Quiz is still being prepared. Please try again shortly.',
      retryable: true,
    });

    // The Node runtime only forwards course outbox events. Go is the sole
    // durable-queue consumer, so this HTTP boundary remains PROCESSING until
    // the Go worker emits its fenced ai.outbox result.
    const processing = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: ownerHeaders(),
    });
    expect(processing.status).toBe(200);
    expect(await processing.json()).toMatchObject({ status: 'PROCESSING' });

    const hidden = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: ownerHeaders(otherOwnerId),
    });
    expect(hidden.status).toBe(404);

    const document = await dataSource.getRepository(Document).findOneByOrFail({
      id: upload.documentId,
    });
    expect(document.ownerId).toBe(ownerId);
  });

  function ownerHeaders(id: string = ownerId): HeadersInit {
    return { 'Content-Type': 'application/json', 'X-User-Id': id };
  }

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${app.getHttpServer().address().port}${path}`, init);
  }
});
