import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { SubtitleSnapshot, SubtitleSnapshotSaveOutcome } from '../contracts/subtitle-snapshot';
import { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';

const MILLISECONDS_PER_SECOND = 1000;

/** Persistence of the parsed subtitle snapshot (course schema). */
@Injectable()
export class SubtitleTranscriptRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Upserts the snapshot and the covered duration in one transaction. The Document row is locked and must still
   * be an UPLOADED YOUTUBE Document, so a preview can never race with confirm or deletion. A new snapshot always
   * clears any earlier rights confirmation.
   */
  async saveSnapshot(
    ownerId: string,
    documentId: string,
    snapshot: SubtitleSnapshot,
  ): Promise<SubtitleSnapshotSaveOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(Document, {
        where: { id: documentId, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) return 'DOCUMENT_NOT_FOUND';
      if (document.type !== DocumentType.YOUTUBE || document.status !== DocumentStatus.UPLOADED) {
        return 'NOT_ALLOWED';
      }
      await manager.query(
        `INSERT INTO "course"."document_subtitle_transcripts"
           ("document_id", "owner_id", "source_format", "source_sha256", "source_size_bytes",
            "parser_version", "cues", "cue_count", "char_count", "duration_ms")
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT ("document_id") DO UPDATE SET
           "source_format" = EXCLUDED."source_format",
           "source_sha256" = EXCLUDED."source_sha256",
           "source_size_bytes" = EXCLUDED."source_size_bytes",
           "parser_version" = EXCLUDED."parser_version",
           "cues" = EXCLUDED."cues",
           "cue_count" = EXCLUDED."cue_count",
           "char_count" = EXCLUDED."char_count",
           "duration_ms" = EXCLUDED."duration_ms",
           "rights_confirmed_at" = NULL,
           "updated_at" = now()`,
        [
          documentId,
          ownerId,
          snapshot.sourceFormat,
          snapshot.sourceSha256,
          snapshot.sourceSizeBytes,
          snapshot.parserVersion,
          JSON.stringify(snapshot.cues),
          snapshot.cueCount,
          snapshot.charCount,
          snapshot.durationMs,
        ],
      );
      await manager.update(
        Document,
        { id: documentId, ownerId },
        { durationSec: Math.ceil(snapshot.durationMs / MILLISECONDS_PER_SECOND) },
      );
      return 'SAVED';
    });
  }
}
