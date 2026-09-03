import { ConflictException, HttpException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';

import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';

describe('ContentService.retry', () => {
  it('starts an owner-scoped retry with the persisted model selection', async () => {
    const failed = createDocument(DocumentStatus.FAILED, DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE);
    const processing = createDocument(DocumentStatus.PROCESSING, null);
    const calls: { readonly find: string[]; readonly retry: string[] } = {
      find: [],
      retry: [],
    };
    const repository = {
      confirmProcessing: async (): Promise<Document | null> => null,
      findByOwnerId: async (ownerId: string, id: string): Promise<Document | null> => {
        calls.find.push(`${ownerId}:${id}`);
        return failed;
      },
      retryProcessing: async (ownerId: string, id: string): Promise<Document | null> => {
        calls.retry.push(`${ownerId}:${id}`);
        return processing;
      },
    };
    const verifier = {
      verify: async (): Promise<{ readonly exists: boolean; readonly magicBytesValid: boolean; readonly sizeBytes: number }> => ({
        exists: true,
        magicBytesValid: true,
        sizeBytes: 1024,
      }),
    };
    const service = new ContentService(repository as never, null as never, verifier, null as never);

    await expect(service.retry('owner-1', 'document-1')).resolves.toBe(processing);
    expect(calls.find).toEqual(['owner-1:document-1']);
    expect(calls.retry).toEqual(['owner-1:document-1']);
  });

  it('returns a stable retry conflict when the retry CAS loses a race', async () => {
    const failed = createDocument(DocumentStatus.FAILED, DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE);
    const repository = {
      findByOwnerId: async (): Promise<Document> => failed,
      retryProcessing: async (): Promise<null> => null,
    };
    const verifier = {
      verify: async (): Promise<{ readonly exists: boolean; readonly magicBytesValid: boolean; readonly sizeBytes: number }> => ({
        exists: true,
        magicBytesValid: true,
        sizeBytes: 1024,
      }),
    };
    const service = new ContentService(repository as never, null as never, verifier, null as never);

    await expectHttpException(
      service.retry('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_RETRY_CONFLICT',
        message: 'Document state changed before processing could be started. Please refresh and try again.',
        retryable: true,
      },
    );
  });

  it('rejects terminal failures before verifying or writing', async () => {
    const failed = createDocument(DocumentStatus.FAILED, DocumentProcessingFailureCode.PDF_INVALID);
    let verifyCalls = 0;
    let retryCalls = 0;
    const repository = {
      findByOwnerId: async (): Promise<Document> => failed,
      retryProcessing: async (): Promise<Document> => {
        retryCalls += 1;
        return failed;
      },
    };
    const verifier = {
      verify: async (): Promise<{ readonly exists: boolean; readonly magicBytesValid: boolean; readonly sizeBytes: number }> => {
        verifyCalls += 1;
        return { exists: true, magicBytesValid: true, sizeBytes: 1024 };
      },
    };
    const service = new ContentService(repository as never, null as never, verifier, null as never);

    await expectHttpException(
      service.retry('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_RETRY_NOT_ALLOWED',
        message: 'This Document failure requires a new upload before processing can be retried.',
        retryable: false,
      },
    );
    expect(verifyCalls).toBe(0);
    expect(retryCalls).toBe(0);
  });

  it('does not reveal an inaccessible Document', async () => {
    const repository = {
      findByOwnerId: async (): Promise<null> => null,
    };
    const service = new ContentService(repository as never, null as never, null as never, null as never);

    await expectHttpException(
      service.retry('stranger', 'document-1'),
      404,
      {
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document document-1 not found',
      },
    );
  });
});

async function expectHttpException(
  operation: Promise<unknown>,
  expectedStatus: number,
  expectedResponse: object,
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected an HTTP exception');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(expectedStatus);
    expect(error.getResponse()).toEqual(expectedResponse);
  }
}

function createDocument(
  status: DocumentStatus,
  errorCode: DocumentProcessingFailureCode | null,
): Document {
  return Object.assign(new Document(), {
    customModelConfigId: null,
    errorCode,
    errorMessage: errorCode === null ? null : 'safe failure message',
    modelSelectionKind: 'PLAN' as const,
    originalName: 'lesson.pdf',
    platformModelId: 'platform-default',
    sizeBytes: 1024,
    status,
    storageRef: 'owner-1/document-1.pdf',
    type: 'PDF' as const,
  });
}
