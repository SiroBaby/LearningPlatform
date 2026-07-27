import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { Document } from '../../src/modules/content/entities/document.entity';
import { Chunk } from '../../src/modules/ai/entities/chunk.entity';
import { GenerationCacheRecord } from '../../src/modules/ai/entities/generation-cache.entity';
import { PromptVersion } from '../../src/modules/ai/entities/prompt-version.entity';
import { LLM_PROVIDER } from '../../src/modules/ai/contracts/llm-provider.contracts';
import { QuizGenerationService } from '../../src/modules/ai/quiz-generation.service';
import { QuestionEntity } from '../../src/modules/assessment/entities/question.entity';
import { QuestionOptionEntity } from '../../src/modules/assessment/entities/question-option.entity';
import { QuizEntity } from '../../src/modules/assessment/entities/quiz.entity';
import { STORAGE_VERIFIER } from '../../src/storage/contracts/storage-verifier.port';
import { STORAGE_OBJECT_READER } from '../../src/storage/contracts/storage-object-reader.port';
import { StorageService } from '../../src/storage/storage.service';
import { PDF_JS_MODULE } from '../../src/modules/ai/extraction.service';
import { startTestDb, TestDb } from '../../src/test-support/test-db';
import { WorkerModule } from '../../src/worker/worker.module';
import { WorkerRunner } from '../../src/worker/worker-runner.service';
import {
  CountingLlmProvider,
  pdfJsWithText,
  TestStorageServer,
} from '../support/document-flow-test-doubles';
import { verifyQuizAttemptFlow } from '../support/quiz-attempt-flow';

describe('Document HTTP flow', () => {
  let db: TestDb;
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: TestStorageServer;
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();

  beforeAll(async () => {
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

    // A compiled WorkerModule executes the production relay/poller/return wiring
    // deterministically in-process, without a separate child process.
    const workerModule = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(PDF_JS_MODULE)
      .useValue(pdfJsWithText('Chunkable lecture content'))
      .overrideProvider(STORAGE_OBJECT_READER)
      .useValue({ read: (objectKey: string) => storage.read(objectKey) })
      .overrideProvider(LLM_PROVIDER)
      .useClass(CountingLlmProvider)
      .compile();
    const workerRunner = workerModule.get(WorkerRunner);
    await workerRunner.onApplicationBootstrap();
    await workerRunner.onApplicationShutdown();

    const ready = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: ownerHeaders(),
    });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'READY' });

    const hidden = await request(`/api/v1/documents/${upload.documentId}`, {
      headers: ownerHeaders(otherOwnerId),
    });
    expect(hidden.status).toBe(404);

    const document = await dataSource.getRepository(Document).findOneByOrFail({
      id: upload.documentId,
    });
    expect(document.ownerId).toBe(ownerId);
    const chunks = await dataSource.getRepository(Chunk).find({
      where: { documentId: upload.documentId, ownerId },
      order: { chunkIndex: 'ASC' },
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      locator: { kind: 'page', page: 1 },
      text: 'Chunkable lecture content',
    });
    const quizzes = await dataSource.getRepository(QuizEntity).find({
      where: { documentId: upload.documentId, ownerId },
    });
    const questions = await dataSource.getRepository(QuestionEntity).find({
      where: { ownerId, quizId: quizzes[0]?.id },
    });
    const options = await dataSource.getRepository(QuestionOptionEntity).find({
      where: { ownerId, questionId: questions[0]?.id },
    });
    expect(quizzes).toHaveLength(1);
    expect(questions).toHaveLength(1);
    expect(options).toHaveLength(2);
    expect(questions[0]?.citation).toEqual({
      chunkId: chunks[0]?.id,
      locator: { kind: 'page', page: 1 },
      snippet: 'Chunkable lecture content',
    });
    expect(await dataSource.getRepository(GenerationCacheRecord).count()).toBe(1);
    expect(await dataSource.getRepository(PromptVersion).count()).toBe(1);

    const quiz = quizzes[0];
    const question = questions[0];
    if (!quiz || !question) {
      throw new Error('Document flow must generate one Quiz and one Question');
    }
    const discoveredQuiz = await request(`/api/v1/documents/${upload.documentId}/quiz`, {
      headers: ownerHeaders(),
    });
    expect(discoveredQuiz.status).toBe(200);
    expect(await discoveredQuiz.json()).toEqual({
      documentId: upload.documentId,
      questionCount: 1,
      quizId: quiz.id,
    });
    const hiddenDiscovery = await request(`/api/v1/documents/${upload.documentId}/quiz`, {
      headers: ownerHeaders(otherOwnerId),
    });
    expect(hiddenDiscovery.status).toBe(404);
    await verifyQuizAttemptFlow({
      dataSource,
      options,
      otherOwnerId,
      ownerHeaders,
      ownerId,
      question,
      quiz,
      request,
    });

    const provider = workerModule.get<CountingLlmProvider>(LLM_PROVIDER);
    await workerModule.get(QuizGenerationService).generate({
      chunks,
      job: {
        documentId: upload.documentId,
        ownerId,
        selection: { customModelConfigId: null, kind: 'PLAN', platformModelId: 'platform-default' },
      },
    });
    expect(provider.callCount).toBe(1);
    expect(await dataSource.getRepository(QuizEntity).count()).toBe(1);
    expect(await dataSource.getRepository(QuestionEntity).count()).toBe(1);
  });

  function ownerHeaders(id: string = ownerId): HeadersInit {
    return { 'Content-Type': 'application/json', 'X-User-Id': id };
  }

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${app.getHttpServer().address().port}${path}`, init);
  }
});
