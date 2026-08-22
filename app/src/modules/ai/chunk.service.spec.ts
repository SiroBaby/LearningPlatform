import { randomUUID } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type { ExtractedSegment } from './contracts/extraction.contracts';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';
import { ChunkService } from './chunk.service';

describe('ChunkService', () => {
  const chunker = new ChunkService({
    worker: { chunkMaxChars: 20, chunkOverlapChars: 5, chunkTargetChars: 15 },
  } as ApplicationConfigService);
  const documentId = randomUUID();
  const ownerId = randomUUID();

  it('returns one chunk for short text and omits empty segments', () => {
    const chunks = chunker.chunk(documentId, ownerId, [
      { text: '  short text  ', locator: { kind: 'text-range', start: 0, end: 14 } },
      { text: '  ', locator: { kind: 'text-range', start: 14, end: 16 } },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, text: 'short text' });
  });

  it('splits long text deterministically with bounded overlap', () => {
    const segments: ExtractedSegment[] = [{
      text: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet',
      locator: { kind: 'text-range', start: 0, end: 63 },
    }];
    const first = chunker.chunk(documentId, ownerId, segments);
    const second = chunker.chunk(documentId, ownerId, segments);

    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => ({ id: chunk.id, hash: chunk.contentHash, text: chunk.text }))).toEqual(
      second.map((chunk) => ({ id: chunk.id, hash: chunk.contentHash, text: chunk.text })),
    );
    expect(first.every((chunk) => chunk.text.length <= 20 && chunk.text.length > 0)).toBe(true);
    expect(first[1].text).toContain('bravo');
    expect(first[0].text).toContain('bravo');
  });

  it('does not merge page locators across a boundary', () => {
    const chunks = chunker.chunk(documentId, ownerId, [
      { text: 'page one', locator: { kind: 'page', page: 1 } },
      { text: 'page two', locator: { kind: 'page', page: 2 } },
    ]);

    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'page', page: 1 },
      { kind: 'page', page: 2 },
    ]);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
  });

  it('keeps text locators aligned after leading and trailing whitespace is removed', () => {
    const chunks = chunker.chunk(documentId, ownerId, [{
      text: '  alpha bravo  ',
      locator: { kind: 'text-range', start: 100, end: 115 },
    }]);

    expect(chunks).toEqual([expect.objectContaining({
      locator: { kind: 'text-range', start: 102, end: 113 },
      text: 'alpha bravo',
    })]);
  });

  it('does not split emoji or combining grapheme clusters', () => {
    const unicodeChunker = new ChunkService({
      worker: {
        chunkMaxChars: 4,
        chunkOverlapChars: 1,
        chunkTargetChars: 4,
        maxChunkTotalChars: 100,
        maxChunksPerDocument: 10,
      },
    } as ApplicationConfigService);
    const text = 'a\u0301 👨‍👩‍👧‍👦 b';
    const chunks = unicodeChunker.chunk(documentId, ownerId, [{
      text,
      locator: { kind: 'text-range', start: 0, end: text.length },
    }]);

    expect(chunks.map((chunk) => chunk.text)).toEqual(['a\u0301', '👨‍👩‍👧‍👦', 'b']);
    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      { kind: 'text-range', start: 0, end: 2 },
      { kind: 'text-range', start: 3, end: 14 },
      { kind: 'text-range', start: 15, end: 16 },
    ]);
  });

  it('fails safely when the configured chunk budget is exceeded', () => {
    const limitedChunker = new ChunkService({
      worker: {
        chunkMaxChars: 5,
        chunkOverlapChars: 1,
        chunkTargetChars: 5,
        maxChunkTotalChars: 100,
        maxChunksPerDocument: 1,
      },
    } as ApplicationConfigService);

    expect(() => limitedChunker.chunk(documentId, ownerId, [{
      text: 'alpha bravo charlie',
      locator: { kind: 'text-range', start: 0, end: 19 },
    }])).toThrow(expect.objectContaining({
      code: DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED,
    }));
  });

  it('fails safely when generated chunk text exceeds the total character budget', () => {
    const limitedChunker = new ChunkService({
      worker: {
        chunkMaxChars: 20,
        chunkOverlapChars: 1,
        chunkTargetChars: 20,
        maxChunkTotalChars: 5,
        maxChunksPerDocument: 10,
      },
    } as ApplicationConfigService);

    expect(() => limitedChunker.chunk(documentId, ownerId, [{
      text: 'six chars',
      locator: { kind: 'text-range', start: 0, end: 9 },
    }])).toThrow(expect.objectContaining({
      code: DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED,
    }));
  });
});
