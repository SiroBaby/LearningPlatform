import { describe, expect, it, jest } from '@jest/globals';
import { ConsoleLogger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { StorageObjectReader } from '../../storage/contracts/storage-object-reader.port';
import { ChunkStore } from './contracts/chunk.contracts';
import { DocumentSourceReader } from './contracts/extraction.contracts';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ProcessingJob } from './entities/processing-job.entity';
import { ExtractionJobProcessor } from './extraction-job-processor.service';
import { ExtractionService, MAX_EXTRACTABLE_OBJECT_BYTES } from './extraction.service';
import { ChunkService } from './chunk.service';
import type { QuizGenerator } from './contracts/quiz-generator.port';

describe('ExtractionJobProcessor', () => {
  it('reads the content-owned storage reference through the bounded storage port', async () => {
    const source: DocumentSourceReader = {
      read: jest.fn(async () => ({ storageRef: 'owner/notes.txt', type: 'TEXT' as const })),
    };
    const objects: StorageObjectReader = { read: jest.fn(async () => Buffer.from('notes')) };
    const chunks: ChunkStore = {
      findForDocument: jest.fn(async () => []),
      replaceForDocument: jest.fn(async () => true),
    };
    const generator = createGenerator();
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, generator);
    const job = createJob();

    await processor.process(job);

    expect(objects.read).toHaveBeenCalledWith('owner/notes.txt', MAX_EXTRACTABLE_OBJECT_BYTES);
    expect(chunks.replaceForDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentId: job.documentId,
      jobId: job.id,
      ownerId: job.ownerId,
      chunks: [expect.objectContaining({ text: 'notes' })],
    }));
    expect(generator.generate).toHaveBeenCalledWith({
      chunks: [],
      job: expect.objectContaining({ documentId: job.documentId, ownerId: job.ownerId }),
    });
  });

  it('maps a storage size breach to a safe structured error code', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/large.pdf', type: 'PDF' }),
    };
    const objects: StorageObjectReader = { read: async () => { throw new RangeError('too large'); } };
    const chunks: ChunkStore = { findForDocument: async () => [], replaceForDocument: async () => true };
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, createGenerator());

    await expect(processor.process(createJob())).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE,
    });
  });

  it('does not return success until durable chunk persistence commits', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/notes.txt', type: 'TEXT' }),
    };
    const objects: StorageObjectReader = { read: async () => Buffer.from('notes') };
    const chunks: ChunkStore = {
      findForDocument: async () => [],
      replaceForDocument: async () => { throw new Error('database unavailable'); },
    };
    const generator = createGenerator();
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, generator);

    await expect(processor.process(createJob())).rejects.toThrow('database unavailable');
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('does not report a stale fenced chunk write as successful processing', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/notes.txt', type: 'TEXT' }),
    };
    const objects: StorageObjectReader = { read: async () => Buffer.from('notes') };
    const chunks: ChunkStore = {
      findForDocument: async () => [],
      replaceForDocument: async () => false,
    };
    const generator = createGenerator();
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, generator);

    await expect(processor.process(createJob())).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.PROCESSING_FAILED,
    });
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it('does not return success until quiz generation and assessment persistence complete', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/notes.txt', type: 'TEXT' }),
    };
    const objects: StorageObjectReader = { read: async () => Buffer.from('notes') };
    const chunks: ChunkStore = {
      findForDocument: async () => [{
        chunkIndex: 0,
        contentHash: '0'.repeat(64),
        id: randomUUID(),
        locator: { kind: 'text-range', start: 0, end: 5 },
        text: 'notes',
      }],
      replaceForDocument: async () => true,
    };
    const generator: QuizGenerator = {
      generate: jest.fn(async () => { throw new Error('assessment unavailable'); }),
    };
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, generator);

    await expect(processor.process(createJob())).rejects.toThrow('assessment unavailable');
  });

  it('emits safe duration events for extraction, chunk persistence, and quiz generation stages', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/private-document.txt', type: 'TEXT' }),
    };
    const objects: StorageObjectReader = { read: async () => Buffer.from('private source text') };
    const chunks: ChunkStore = {
      findForDocument: async () => [],
      replaceForDocument: async () => true,
    };
    const logger = jest.spyOn(ConsoleLogger.prototype, 'log').mockImplementation(() => undefined);
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), new ChunkService(), chunks, createGenerator());
    const job = createJob();

    await processor.process(job);

    const events = logger.mock.calls
      .map(([event]) => event)
      .filter((event): event is Record<string, unknown> => typeof event === 'object' && event !== null && 'event' in event);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'ai.extraction.extract.completed' }),
      expect.objectContaining({ event: 'ai.extraction.chunk.completed' }),
      expect.objectContaining({ event: 'ai.extraction.chunk_persist.completed' }),
      expect.objectContaining({ event: 'ai.extraction.generate.completed' }),
    ]));
    for (const event of events) {
      expect(event).toEqual(expect.objectContaining({
        attempt: job.attempts,
        correlationId: job.correlationId,
        durationMs: expect.any(Number),
        jobId: job.id,
      }));
      expect(Object.keys(event)).not.toEqual(expect.arrayContaining([
        'source',
        'storageRef',
        'text',
        'prompt',
        'output',
        'citation',
      ]));
    }
    logger.mockRestore();
  });
});

function createGenerator(): QuizGenerator & { generate: ReturnType<typeof jest.fn<QuizGenerator['generate']>> } {
  return { generate: jest.fn<QuizGenerator['generate']>().mockResolvedValue(undefined) };
}

function createJob(): ProcessingJob {
  return {
    id: randomUUID(),
    documentId: randomUUID(),
    ownerId: randomUUID(),
    jobType: 'FULL_PIPELINE' as ProcessingJob['jobType'],
    status: 'RUNNING' as ProcessingJob['status'],
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
    attempts: 0,
    errorMessage: null,
    estimatedCredits: null,
    settledCredits: null,
    budgetStatus: null,
    customModelConfigId: null,
    modelSelectionKind: null,
    platformModelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
