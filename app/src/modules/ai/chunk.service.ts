import { createHash } from 'crypto';

import { Injectable, Optional } from '@nestjs/common';

import { ApplicationConfigService } from '../../config/application-config.service';

import type { ChunkCandidate } from './contracts/chunk.contracts';
import type { ExtractedSegment, Locator, TextRangeLocator } from './contracts/extraction.contracts';
import { ExtractionError } from './contracts/extraction-error';
import { DocumentProcessingFailureCode } from './contracts/document-processing-result';

const DEFAULT_TARGET_CHARS = 1_200;
const DEFAULT_MAX_CHARS = 1_500;
const DEFAULT_OVERLAP_CHARS = 150;
const DEFAULT_MAX_CHUNKS_PER_DOCUMENT = 20_000;
const DEFAULT_MAX_CHUNK_TOTAL_CHARS = 24_000_000;

interface GraphemeSegment {
  readonly index: number;
}

interface GraphemeSegmenter {
  segment(text: string): Iterable<GraphemeSegment>;
}

interface IntlWithSegmenter {
  readonly Segmenter: new (
    locales: string | readonly string[] | undefined,
    options: { readonly granularity: 'grapheme' },
  ) => GraphemeSegmenter;
}

@Injectable()
export class ChunkService {
  constructor(@Optional() private readonly config?: ApplicationConfigService) {}

  chunk(documentId: string, ownerId: string, segments: readonly ExtractedSegment[]): ChunkCandidate[] {
    const chunks: ChunkCandidate[] = [];
    let totalChars = 0;
    for (const segment of segments) {
      for (const part of this.splitSegment(segment)) {
        totalChars += part.text.length;
        if (
          chunks.length >= this.settings.maxChunksPerDocument ||
          totalChars > this.settings.maxChunkTotalChars
        ) {
          throw new ExtractionError(
            DocumentProcessingFailureCode.CHUNK_RESOURCE_LIMIT_EXCEEDED,
          );
        }
        const chunkIndex = chunks.length;
        const contentHash = this.hash(part.text);
        chunks.push({
          chunkIndex,
          contentHash,
          id: this.deterministicUuid(`${documentId}:${ownerId}:${chunkIndex}:${contentHash}`),
          locator: part.locator,
          text: part.text,
        });
      }
    }
    return chunks;
  }

  private splitSegment(segment: ExtractedSegment): Array<{ locator: Locator; text: string }> {
    const bounds = this.trimBounds(segment.text, 0, segment.text.length);
    if (bounds.start === bounds.end) return [];
    const text = segment.text.slice(bounds.start, bounds.end);
    const { chunkMaxChars, chunkOverlapChars, chunkTargetChars } = this.settings;
    const graphemeBoundaries = this.graphemeBoundaries(text);
    const result: Array<{ locator: Locator; text: string }> = [];
    let start = 0;
    while (start < text.length) {
      const end = this.selectChunkEnd(text, start, graphemeBoundaries, chunkMaxChars, chunkTargetChars);
      const partBounds = this.trimBounds(text, start, end);
      const value = text.slice(partBounds.start, partBounds.end);
      if (value) {
        result.push({
          locator: this.locatorForPart(
            segment.locator,
            bounds.start + partBounds.start,
            bounds.start + partBounds.end,
          ),
          text: value,
        });
      }
      if (end === text.length) break;
      const overlapStart = this.previousBoundary(
        graphemeBoundaries,
        Math.max(end - chunkOverlapChars, start + 1),
        start,
      );
      start = overlapStart > start ? overlapStart : end;
    }
    return result;
  }

  private get settings(): {
    chunkMaxChars: number;
    chunkOverlapChars: number;
    chunkTargetChars: number;
    maxChunksPerDocument: number;
    maxChunkTotalChars: number;
  } {
    const settings = this.config?.worker;
    const chunkMaxChars = settings?.chunkMaxChars ?? DEFAULT_MAX_CHARS;
    const chunkOverlapChars = settings?.chunkOverlapChars ?? DEFAULT_OVERLAP_CHARS;
    const chunkTargetChars = settings?.chunkTargetChars ?? DEFAULT_TARGET_CHARS;
    const maxChunksPerDocument = settings?.maxChunksPerDocument ?? DEFAULT_MAX_CHUNKS_PER_DOCUMENT;
    const maxChunkTotalChars = settings?.maxChunkTotalChars ?? DEFAULT_MAX_CHUNK_TOTAL_CHARS;
    return {
      chunkMaxChars,
      chunkOverlapChars,
      chunkTargetChars,
      maxChunksPerDocument,
      maxChunkTotalChars,
    };
  }

  private trimBounds(text: string, start: number, end: number): { end: number; start: number } {
    let first = start;
    let last = end;
    while (first < last && /\s/u.test(text[first])) first += 1;
    while (last > first && /\s/u.test(text[last - 1])) last -= 1;
    return { end: last, start: first };
  }

  private graphemeBoundaries(text: string): number[] {
    const Segmenter = (Intl as unknown as IntlWithSegmenter).Segmenter;
    if (!Segmenter) {
      throw new Error('Intl.Segmenter is required for Unicode-safe chunking');
    }
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
      .map((segment) => segment.index)
      .concat(text.length);
  }

  private selectChunkEnd(
    text: string,
    start: number,
    boundaries: readonly number[],
    maxChars: number,
    targetChars: number,
  ): number {
    const maxEnd = this.previousBoundary(boundaries, start + maxChars, start);
    if (maxEnd >= text.length) return text.length;
    const preferredEnd = this.previousBoundary(boundaries, start + targetChars, start);
    for (let index = boundaries.indexOf(preferredEnd); index >= 0; index -= 1) {
      const boundary = boundaries[index];
      if (boundary <= start) break;
      if (/\s/u.test(text[boundary])) return boundary;
    }
    return maxEnd > start ? maxEnd : this.nextBoundary(boundaries, start);
  }

  private previousBoundary(boundaries: readonly number[], candidate: number, minimum: number): number {
    for (let index = boundaries.length - 1; index >= 0; index -= 1) {
      if (boundaries[index] <= candidate && boundaries[index] > minimum) return boundaries[index];
    }
    return minimum;
  }

  private nextBoundary(boundaries: readonly number[], start: number): number {
    const boundary = boundaries.find((value) => value > start);
    if (boundary === undefined) throw new Error('Missing grapheme boundary');
    return boundary;
  }

  private locatorForPart(locator: Locator, start: number, end: number): Locator {
    if (locator.kind !== 'text-range') return locator;
    const range: TextRangeLocator = locator;
    return { kind: 'text-range', start: range.start + start, end: range.start + end };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private deterministicUuid(value: string): string {
    const bytes = createHash('sha256').update(value).digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
}
