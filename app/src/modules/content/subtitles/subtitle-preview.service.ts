import { createHash } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { StorageService } from '../../../storage/storage.service';
import { SubtitlePreviewResult } from '../contracts/subtitle-preview.result';
import type { SubtitleSnapshot } from '../contracts/subtitle-snapshot';
import type { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';
import { ContentRepository } from '../repositories/content.repository';
import { SubtitleTranscriptRepository } from '../repositories/subtitle-transcript.repository';
import { SubtitleParseError, SubtitleParseErrorCode } from './subtitle-parse-error';
import { parseSubtitle } from './subtitle-parser';
import { MAX_SUBTITLE_BYTES, MILLISECONDS_PER_SECOND, SUBTITLE_PARSER_VERSION } from './subtitle.constants';
import type { ParsedSubtitle, SubtitleFormat } from './subtitle.types';

const MISSING_OBJECT_ERROR_NAMES: ReadonlySet<string> = new Set(['NoSuchKey', 'NotFound']);

const PARSE_ERROR_MESSAGES: Readonly<Record<SubtitleParseErrorCode, string>> = {
  [SubtitleParseErrorCode.SUBTITLE_TOO_LARGE]: 'The subtitle file is larger than 5 MiB.',
  [SubtitleParseErrorCode.SUBTITLE_ENCODING_INVALID]: 'The subtitle file is not valid UTF-8 text.',
  [SubtitleParseErrorCode.SUBTITLE_FORMAT_INVALID]: 'The subtitle file is not a valid .vtt or .srt file.',
  [SubtitleParseErrorCode.SUBTITLE_TIMESTAMP_INVALID]: 'A subtitle timestamp is invalid.',
  [SubtitleParseErrorCode.SUBTITLE_CUE_TOO_LONG]: 'A subtitle cue is longer than 2,000 characters.',
  [SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CUES]: 'The subtitle has more than 10,000 cues.',
  [SubtitleParseErrorCode.SUBTITLE_TOO_MANY_CHARS]: 'The subtitle has more than 500,000 characters.',
  [SubtitleParseErrorCode.SUBTITLE_EMPTY]: 'The subtitle has no text.',
};

/** Parses an uploaded subtitle, stores the snapshot Go will read, and returns every cue for Owner review. */
@Injectable()
export class SubtitlePreviewService {
  constructor(
    private readonly documents: ContentRepository,
    private readonly storage: StorageService,
    private readonly snapshots: SubtitleTranscriptRepository,
  ) {}

  async preview(ownerId: string, documentId: string): Promise<SubtitlePreviewResult> {
    const document = await this.findPreviewableDocument(ownerId, documentId);
    const source = await this.readSubtitleObject(document);
    const parsed = this.parse(source, detectSubtitleFormat(document.originalName));
    const outcome = await this.snapshots.saveSnapshot(ownerId, documentId, toSnapshot(parsed, source));
    if (outcome === 'DOCUMENT_NOT_FOUND') throw this.documentNotFound(documentId);
    if (outcome === 'NOT_ALLOWED') throw this.previewNotAllowed();
    return toPreviewResult(parsed);
  }

  private async findPreviewableDocument(ownerId: string, documentId: string): Promise<Document> {
    const document = await this.documents.findByOwnerId(ownerId, documentId);
    if (!document || document.status === DocumentStatus.DELETING) throw this.documentNotFound(documentId);
    if (document.type !== DocumentType.YOUTUBE || document.status !== DocumentStatus.UPLOADED) {
      throw this.previewNotAllowed();
    }
    return document;
  }

  private async readSubtitleObject(document: Document): Promise<Buffer> {
    let source: Buffer;
    try {
      source = await this.storage.readObject(document.storageRef, MAX_SUBTITLE_BYTES);
    } catch (error) {
      if (error instanceof RangeError) throw this.parseFailure(new SubtitleParseError(SubtitleParseErrorCode.SUBTITLE_TOO_LARGE));
      if (isMissingObjectError(error)) throw new BadRequestException('Uploaded file failed verification');
      throw error;
    }
    if (source.length !== Number(document.sizeBytes)) {
      throw new BadRequestException('Uploaded file failed verification');
    }
    return source;
  }

  private parse(source: Buffer, format: SubtitleFormat): ParsedSubtitle {
    try {
      return parseSubtitle(source, format);
    } catch (error) {
      if (error instanceof SubtitleParseError) throw this.parseFailure(error);
      throw error;
    }
  }

  private parseFailure(error: SubtitleParseError): BadRequestException {
    return new BadRequestException({
      code: error.code,
      message: PARSE_ERROR_MESSAGES[error.code],
      retryable: false,
      ...(error.line === undefined ? {} : { line: error.line }),
    });
  }

  private previewNotAllowed(): ConflictException {
    return new ConflictException({
      code: 'SUBTITLE_PREVIEW_NOT_ALLOWED',
      message: 'A subtitle preview is only available for an uploaded YouTube Document that has not started processing.',
      retryable: false,
    });
  }

  private documentNotFound(documentId: string): NotFoundException {
    return new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: `Document ${documentId} not found` });
  }
}

/** The stored original name was validated against the YOUTUBE policy, so anything but .srt is WebVTT. */
function detectSubtitleFormat(originalName: string): SubtitleFormat {
  return originalName.toLowerCase().endsWith('.srt') ? 'SRT' : 'VTT';
}

function isMissingObjectError(error: unknown): boolean {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as { name?: unknown; Code?: unknown; code?: unknown };
  return [failure.name, failure.Code, failure.code].some(
    (value) => typeof value === 'string' && MISSING_OBJECT_ERROR_NAMES.has(value),
  );
}

function toSnapshot(parsed: ParsedSubtitle, source: Buffer): SubtitleSnapshot {
  return {
    charCount: parsed.charCount,
    cueCount: parsed.cueCount,
    cues: parsed.cues,
    durationMs: parsed.durationMs,
    parserVersion: SUBTITLE_PARSER_VERSION,
    sourceFormat: parsed.format,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    sourceSizeBytes: source.length,
  };
}

function toPreviewResult(parsed: ParsedSubtitle): SubtitlePreviewResult {
  return Object.assign(new SubtitlePreviewResult(), {
    charCount: parsed.charCount,
    cueCount: parsed.cueCount,
    cues: parsed.cues.map((cue) => ({
      endSec: cue.endMs / MILLISECONDS_PER_SECOND,
      startSec: cue.startMs / MILLISECONDS_PER_SECOND,
      text: cue.text,
    })),
    durationSec: Math.ceil(parsed.durationMs / MILLISECONDS_PER_SECOND),
    format: parsed.format,
  });
}
