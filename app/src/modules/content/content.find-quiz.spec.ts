import { HttpException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';

import type { QuizDiscovery, QuizDiscoverySummary } from '../assessment/contracts/quiz-discovery.port';
import { ContentService } from './content.service';
import { Document } from './entities/document.entity';
import { DocumentStatus } from './enums/document-status.enum';
import { DocumentProcessingFailureCode } from '../ai/contracts/document-processing-result';

describe('ContentService.findQuiz', () => {
  it('returns DOCUMENT_NOT_FOUND when the Document is missing or not owned by the requester', async () => {
    const repository = new RecordingContentRepository(null);
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('requesting-owner', 'document-1'),
      404,
      {
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document document-1 not found',
      },
    );

    expect(repository.lookups).toEqual([{ ownerId: 'requesting-owner', documentId: 'document-1' }]);
    expect(quizzes.lookups).toEqual([]);
  });

  it.each([DocumentStatus.UPLOADED, DocumentStatus.PROCESSING])(
    'returns QUIZ_NOT_READY when an owned %s Document has no Quiz',
    async (status) => {
      const repository = new RecordingContentRepository(createDocument(status, null));
      const quizzes = new RecordingQuizDiscovery(null);
      const service = new ContentService(repository as never, null as never, null as never, quizzes);

      await expectQuizException(
        service.findQuiz('owner-1', 'document-1'),
        409,
        {
          code: 'QUIZ_NOT_READY',
          message: 'Quiz is still being prepared. Please try again shortly.',
          retryable: true,
        },
      );

      expect(repository.lookups).toEqual([{ ownerId: 'owner-1', documentId: 'document-1' }]);
      expect(quizzes.lookups).toEqual([{ ownerId: 'owner-1', documentId: 'document-1' }]);
    },
  );

  it('returns DOCUMENT_PROCESSING_FAILED with the persisted message when an owned FAILED Document has no Quiz', async () => {
    const repository = new RecordingContentRepository(createDocument(DocumentStatus.FAILED, 'Processing exceeded the provider time limit.'));
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_PROCESSING_FAILED',
        message: 'Processing exceeded the provider time limit.',
        retryable: false,
      },
    );
  });

  it('returns DOCUMENT_PROCESSING_FAILED with a safe fallback when an owned FAILED Document has no error message', async () => {
    const repository = new RecordingContentRepository(createDocument(DocumentStatus.FAILED, null));
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_PROCESSING_FAILED',
        message: 'Document processing failed. Please try again later.',
        retryable: false,
      },
    );
  });

  it('marks exhausted processing budget as retryable', async () => {
    const document = createDocument(DocumentStatus.FAILED, 'Processing budget was exhausted');
    document.budgetStatus = 'EXHAUSTED';
    document.errorCode = DocumentProcessingFailureCode.BUDGET_EXHAUSTED;
    const repository = new RecordingContentRepository(document);
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_PROCESSING_FAILED',
        message: 'Processing budget was exhausted',
        retryable: true,
      },
    );
  });

  it('marks an unavailable provider failure as retryable from its stable code', async () => {
    const document = createDocument(
      DocumentStatus.FAILED,
      'Document processing is temporarily unavailable. Please try again later.',
    );
    document.errorCode = DocumentProcessingFailureCode.PROVIDER_UNAVAILABLE;
    const repository = new RecordingContentRepository(document);
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('owner-1', 'document-1'),
      409,
      {
        code: 'DOCUMENT_PROCESSING_FAILED',
        message: 'Document processing is temporarily unavailable. Please try again later.',
        retryable: true,
      },
    );
  });

  it.each([
    [DocumentProcessingFailureCode.GENERATION_OUTPUT_INVALID, true],
    [DocumentProcessingFailureCode.GENERATION_OUTPUT_TRUNCATED, true],
    [DocumentProcessingFailureCode.INSUFFICIENT_VALID_QUESTIONS, false],
    [DocumentProcessingFailureCode.PROCESSING_TIMED_OUT, true],
  ] satisfies readonly (readonly [DocumentProcessingFailureCode, boolean])[])(
    'uses the retryability policy for %s',
    async (errorCode, retryable) => {
      const document = createDocument(DocumentStatus.FAILED, 'Safe failure message');
      document.errorCode = errorCode;
      const repository = new RecordingContentRepository(document);
      const quizzes = new RecordingQuizDiscovery(null);
      const service = new ContentService(repository as never, null as never, null as never, quizzes);

      await expectQuizException(
        service.findQuiz('owner-1', 'document-1'),
        409,
        {
          code: 'DOCUMENT_PROCESSING_FAILED',
          message: 'Safe failure message',
          retryable,
        },
      );
    },
  );

  it('returns QUIZ_INVARIANT_VIOLATION when an owned READY Document has no Quiz', async () => {
    const repository = new RecordingContentRepository(createDocument(DocumentStatus.READY, null));
    const quizzes = new RecordingQuizDiscovery(null);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expectQuizException(
      service.findQuiz('owner-1', 'document-1'),
      500,
      {
        code: 'QUIZ_INVARIANT_VIOLATION',
        message: 'Quiz is unavailable due to a system error. Please try again later.',
        retryable: false,
      },
    );
  });

  it('returns the existing Quiz unchanged', async () => {
    const quiz: QuizDiscoverySummary = {
      documentId: 'document-1',
      questionCount: 5,
      quizId: 'quiz-1',
    };
    const repository = new RecordingContentRepository(createDocument(DocumentStatus.READY, null));
    const quizzes = new RecordingQuizDiscovery(quiz);
    const service = new ContentService(repository as never, null as never, null as never, quizzes);

    await expect(service.findQuiz('owner-1', 'document-1')).resolves.toEqual(quiz);
  });
});

async function expectQuizException(
  operation: Promise<unknown>,
  expectedStatus: number,
  expectedResponse: object,
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected findQuiz to throw an HTTP exception');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(expectedStatus);
    expect(error.getResponse()).toEqual(expectedResponse);
  }
}

function createDocument(status: DocumentStatus, errorMessage: string | null): Document {
  const document = new Document();
  document.id = 'document-1';
  document.ownerId = 'owner-1';
  document.status = status;
  document.errorMessage = errorMessage;
  return document;
}

class RecordingContentRepository {
  readonly lookups: { readonly documentId: string; readonly ownerId: string }[] = [];

  constructor(private readonly document: Document | null) {}

  async findByOwnerId(ownerId: string, documentId: string): Promise<Document | null> {
    this.lookups.push({ documentId, ownerId });
    return this.document;
  }
}

class RecordingQuizDiscovery implements QuizDiscovery {
  readonly lookups: { readonly documentId: string; readonly ownerId: string }[] = [];

  constructor(private readonly quiz: QuizDiscoverySummary | null) {}

  async findAllByOwnerId(): Promise<readonly QuizDiscoverySummary[]> {
    return [];
  }

  async findByOwnerAndDocumentId(
    ownerId: string,
    documentId: string,
  ): Promise<QuizDiscoverySummary | null> {
    this.lookups.push({ documentId, ownerId });
    return this.quiz;
  }
}
