import { describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'crypto';

import { StorageObjectReader } from '../../storage/contracts/storage-object-reader.port';
import { DocumentSourceReader, ExtractedSegmentSink } from './contracts/extraction.contracts';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ProcessingJob } from './entities/processing-job.entity';
import { ExtractionJobProcessor } from './extraction-job-processor.service';
import { ExtractionService, MAX_EXTRACTABLE_OBJECT_BYTES } from './extraction.service';

describe('ExtractionJobProcessor', () => {
  it('reads the content-owned storage reference through the bounded storage port', async () => {
    const source: DocumentSourceReader = {
      read: jest.fn(async () => ({ storageRef: 'owner/notes.txt', type: 'TEXT' as const })),
    };
    const objects: StorageObjectReader = { read: jest.fn(async () => Buffer.from('notes')) };
    const sink: ExtractedSegmentSink = { save: jest.fn(async () => undefined) };
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), sink);
    const job = createJob();

    await processor.process(job);

    expect(objects.read).toHaveBeenCalledWith('owner/notes.txt', MAX_EXTRACTABLE_OBJECT_BYTES);
    expect(sink.save).toHaveBeenCalledWith(job, [
      { text: 'notes', locator: { kind: 'text-range', start: 0, end: 5 } },
    ]);
  });

  it('maps a storage size breach to a safe structured error code', async () => {
    const source: DocumentSourceReader = {
      read: async () => ({ storageRef: 'owner/large.pdf', type: 'PDF' }),
    };
    const objects: StorageObjectReader = { read: async () => { throw new RangeError('too large'); } };
    const sink: ExtractedSegmentSink = { save: async () => undefined };
    const processor = new ExtractionJobProcessor(source, objects, new ExtractionService(), sink);

    await expect(processor.process(createJob())).rejects.toMatchObject({
      code: DocumentProcessingFailureCode.EXTRACTION_OBJECT_TOO_LARGE,
    });
  });
});

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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
