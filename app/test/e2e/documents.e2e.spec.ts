import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { Document } from '../../src/modules/content/entities/document.entity';
import { AuthRepository } from '../../src/modules/auth/repositories/auth.repository';
import { AccountRole } from '../../src/modules/auth/enums/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/enums/account-status.enum';
import { User } from '../../src/modules/auth/entities/user.entity';
import { STORAGE_VERIFIER } from '../../src/storage/contracts/storage-verifier.port';
import { StorageService } from '../../src/storage/storage.service';
import { PDF_JS_MODULE } from '../../src/modules/ai/extraction.service';
import { startTestDb, TestDb } from '../../src/test-support/test-db';
import {
  pdfJsWithText,
  TestStorageServer,
} from '../support/document-flow-test-doubles';
import { clearDocumentFlowData } from '../support/test-database-cleanup';

describe('Document HTTP flow', () => {
  let db: TestDb;
  let app: INestApplication;
  let dataSource: DataSource;
  let authRepository: AuthRepository;
  let storage: TestStorageServer;
  const accessTokens = new Map<string, string>();
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();

  beforeAll(async () => {
    // AppModule eagerly constructs the OAuth provider; e2e uses bearer-session
    // fixtures, so provide non-secret OAuth values for bootstrap.
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
    authRepository = new AuthRepository(dataSource);
  });

  afterAll(async () => {
    await app?.close();
    await storage?.stop();
    await db?.stop();
  });

  beforeEach(async () => {
    await clearDocumentFlowData(db.client);
    await dataSource.getRepository(User).insert([
      {
        id: ownerId,
        emailVerified: true,
        googleSub: `e2e-owner-${ownerId}`,
        normalizedEmail: `${ownerId}@example.com`,
        role: AccountRole.USER,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      {
        id: otherOwnerId,
        emailVerified: true,
        googleSub: `e2e-other-owner-${otherOwnerId}`,
        normalizedEmail: `${otherOwnerId}@example.com`,
        role: AccountRole.USER,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
    ]);
    accessTokens.clear();
    accessTokens.set(ownerId, (await authRepository.createSessionPair(ownerId)).accessToken);
    accessTokens.set(otherOwnerId, (await authRepository.createSessionPair(otherOwnerId)).accessToken);
  });

  it('creates, confirms and exposes an owned document through HTTP', async () => {
    const estimate = await request('/api/v1/documents/estimate', {
      method: 'POST',
      headers: authHeaders(),
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
      headers: authHeaders(),
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
      { method: 'POST', headers: authHeaders() },
    );
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({
      documentId: upload.documentId,
      status: 'PROCESSING',
    });

    const fetched = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: authHeaders(),
    });
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({
      id: upload.documentId,
      status: 'PROCESSING',
      sizeBytes: 22,
    });

    const newerCreated = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: authHeaders(),
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
      headers: authHeaders(),
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
      headers: authHeaders(otherOwnerId),
    });
    expect(hiddenList.status).toBe(200);
    expect(await hiddenList.json()).toEqual([]);

    const absentQuiz = await request(`/api/v1/documents/${newerUpload.documentId}/quiz`, {
      headers: authHeaders(),
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
      headers: authHeaders(),
    });
    expect(processing.status).toBe(200);
    expect(await processing.json()).toMatchObject({ status: 'PROCESSING' });

    const hidden = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: authHeaders(otherOwnerId),
    });
    expect(hidden.status).toBe(404);

    const document = await dataSource.getRepository(Document).findOneByOrFail({
      id: upload.documentId,
    });
    expect(document.ownerId).toBe(ownerId);
  });

  it('rejects deleted-user access and presigned URL creation while retaining the product row', async () => {
    const created = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        originalName: 'retained-after-delete.pdf',
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(created.status).toBe(201);
    const upload = await created.json() as { readonly documentId: string };

    await authRepository.updateAccountStatus(ownerId, AccountStatus.DELETED, 'ACCOUNT_DELETED');

    const list = await request('/api/v1/documents', { headers: authHeaders() });
    expect(list.status).toBe(401);
    const presign = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        originalName: 'should-not-be-issued.pdf',
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(presign.status).toBe(401);

    const retained = await dataSource.getRepository(Document).findOneByOrFail({ id: upload.documentId });
    expect(retained.ownerId).toBe(ownerId);
    const otherOwnerView = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: authHeaders(otherOwnerId),
    });
    expect(otherOwnerView.status).toBe(404);
  });

  it('rejects presigned URL creation for a suspended user', async () => {
    await authRepository.updateAccountStatus(ownerId, AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');

    const presign = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        originalName: 'should-not-be-issued.pdf',
        modelSelectionKind: 'PLAN',
        platformModelId: 'platform-default',
        sizeBytes: 22,
        type: 'PDF',
      }),
    });
    expect(presign.status).toBe(401);
  });

  function authHeaders(id: string = ownerId): HeadersInit {
    const accessToken = accessTokens.get(id);
    if (!accessToken) throw new Error(`Missing test session for owner ${id}`);
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  }

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${app.getHttpServer().address().port}${path}`, init);
  }
});
