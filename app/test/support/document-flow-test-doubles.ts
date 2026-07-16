import { createServer, type Server } from 'node:http';

import type {
  JsonValue,
  LlmGenerationRequest,
  LlmProvider,
} from '../../src/modules/ai/contracts/llm-provider.contracts';
import type { PdfJsModule } from '../../src/modules/ai/extraction.service';

export class TestStorageServer {
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
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
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

  async createUploadForm(objectKey: string): Promise<{
    expirySec: number;
    formFields: Record<string, string>;
    url: string;
  }> {
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test storage server is not listening');
    }
    return {
      expirySec: 300,
      formFields: { key: objectKey, policy: 'test-policy' },
      url: `http://127.0.0.1:${address.port}/objects/upload`,
    };
  }

  async verify(objectKey: string): Promise<{
    exists: boolean;
    magicBytesValid: boolean;
    sizeBytes: number;
  }> {
    const object = this.objects.get(objectKey);
    return {
      exists: object !== undefined,
      magicBytesValid: object?.subarray(0, 4).equals(Buffer.from('%PDF')) ?? false,
      sizeBytes: object?.length ?? 0,
    };
  }

  async read(objectKey: string): Promise<Buffer> {
    const object = this.objects.get(objectKey);
    if (!object) throw new Error('not found');
    return object;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

export function pdfJsWithText(text: string): PdfJsModule {
  return {
    getDocument: () => ({
      destroy: () => undefined,
      promise: Promise.resolve({
        destroy: async () => undefined,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ hasEOL: false, str: text }] }),
        }),
        numPages: 1,
      }),
    }),
  };
}

export class CountingLlmProvider implements LlmProvider {
  readonly model = 'e2e-counting-v1';
  readonly providerIdentity = 'fake:e2e-counting-v1';
  callCount = 0;

  async generate(request: LlmGenerationRequest): Promise<JsonValue> {
    this.callCount += 1;
    return {
      questions: [{
        explanation: 'The answer is grounded in the supplied source.',
        options: [
          { content: request.sourceText, isCorrect: true },
          { content: 'Unsupported alternative', isCorrect: false },
        ],
        stem: 'Which statement appears in the source?',
      }],
    };
  }
}
