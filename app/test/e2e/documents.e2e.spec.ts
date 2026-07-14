import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { Document } from '../../src/modules/content/entities/document.entity';
import { STORAGE_VERIFIER } from '../../src/storage/contracts/storage-verifier.port';
import { StorageService } from '../../src/storage/storage.service';
import { startTestDb, TestDb } from '../../src/test-support/test-db';
import { WorkerModule } from '../../src/worker/worker.module';
import { WorkerRunner } from '../../src/worker/worker-runner.service';

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
      'TRUNCATE "course"."documents", "course"."outbox", "ai"."outbox", "ai"."processing_jobs"',
    );
  });

  it('creates, confirms and exposes an owned document through HTTP', async () => {
    const created = await request('/api/v1/documents/upload-url', {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({
        originalName: 'lecture.pdf',
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

    // A compiled WorkerModule executes the production relay/poller/return wiring
    // deterministically in-process, without a separate child process.
    const workerModule = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
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
  });

  function ownerHeaders(id = ownerId): HeadersInit {
    return { 'Content-Type': 'application/json', 'X-User-Id': id };
  }

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${app.getHttpServer().address().port}${path}`, init);
  }
});

class TestStorageServer {
  private readonly objects = new Map<string, Buffer>();

  private constructor(private readonly server: Server) {}

  static async start(): Promise<TestStorageServer> {
    let storage: TestStorageServer;
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || !request.url?.startsWith('/objects/')) {
        response.statusCode = 404;
        response.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const key = body.toString().match(/name="key"\r\n\r\n([^\r]+)/)?.[1];
      const fileStart = body.indexOf(Buffer.from('%PDF'));
      if (!key || fileStart < 0) {
        response.statusCode = 400;
        response.end();
        return;
      }
      storage.objects.set(key, body.subarray(fileStart, body.indexOf('\r\n--', fileStart)));
      response.statusCode = 200;
      response.end();
    });
    storage = new TestStorageServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return storage;
  }

  async createUploadForm(objectKey: string): Promise<{ formFields: Record<string, string>; url: string; expirySec: number }> {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test storage server is not listening');
    }

    return {
      formFields: { key: objectKey, policy: 'test-policy' },
      url: `http://127.0.0.1:${address.port}/objects/upload`,
      expirySec: 300,
    };
  }

  async verify(objectKey: string): Promise<{
    exists: boolean;
    sizeBytes: number;
    magicBytesValid: boolean;
  }> {
    const object = this.objects.get(objectKey);
    return {
      exists: object !== undefined,
      sizeBytes: object?.length ?? 0,
      magicBytesValid: object?.subarray(0, 4).equals(Buffer.from('%PDF')) ?? false,
    };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
