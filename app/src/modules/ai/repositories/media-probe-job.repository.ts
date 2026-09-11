import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { normalizeStorageVersionId } from '../../../storage/storage-version-id';
import type {
  DocumentCancellationCommand,
  MediaProbeEnqueueCommand,
} from '../contracts/ai-ingestion.port';
import { MediaProbeJob } from '../entities/media-probe-job.entity';

@Injectable()
export class MediaProbeJobRepository extends BaseRepository<MediaProbeJob> {
  constructor(private readonly dataSource: DataSource) {
    super(MediaProbeJob, dataSource);
  }

  async enqueue(command: MediaProbeEnqueueCommand, idempotencyKey: string): Promise<void> {
    const sourceVersionId = normalizeStorageVersionId(command.sourceVersionId);
    const sourceEtag = command.sourceEtag.trim();
    if (sourceVersionId === undefined) {
      throw new Error('Media probe source version is unavailable');
    }
    if (sourceEtag === '') {
      throw new Error('Media probe source ETag is unavailable');
    }
    await this.dataSource.transaction(async (manager) => {
      await this.lockDocument(manager, command.documentId, command.ownerId);

      const revoked: Array<{ readonly marker: number }> = await manager.query(
        `SELECT 1 AS "marker"
         FROM "ai"."account_access_revocations"
         WHERE "user_id" = $1
         LIMIT 1`,
        [command.ownerId],
      );
      if (revoked.length > 0) return;

      const tombstones: Array<{ readonly deletion_fence: string }> = await manager.query(
        `SELECT "deletion_fence"
         FROM "ai"."media_probe_cancellation_tombstones"
         WHERE "document_id" = $1
           AND "owner_id" = $2
           AND "deletion_fence" >= $3
         ORDER BY "deletion_fence" DESC
         LIMIT 1`,
        [command.documentId, command.ownerId, command.deletionFence],
      );
      if (tombstones.length > 0) return;

      const rows: Array<{ readonly id: string }> = await manager.query(
        `INSERT INTO "ai"."media_probe_jobs"
          ("document_id", "owner_id", "correlation_id", "probe_generation",
           "policy_version", "deletion_fence", "full_pipeline_job_id",
           "source_bucket", "source_key", "source_version_id", "source_etag",
           "source_content_length", "status", "idempotency_key")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::varchar, $6::bigint,
                 $7::uuid, $8::varchar, $9::varchar, $10::varchar, $11::varchar,
                 $12::bigint, 'PENDING', $13::varchar)
         ON CONFLICT ("idempotency_key") DO UPDATE
           SET "id" = "media_probe_jobs"."id"
           WHERE "media_probe_jobs"."document_id" = EXCLUDED."document_id"
             AND "media_probe_jobs"."owner_id" = EXCLUDED."owner_id"
             AND "media_probe_jobs"."correlation_id" = EXCLUDED."correlation_id"
             AND "media_probe_jobs"."probe_generation" = EXCLUDED."probe_generation"
             AND "media_probe_jobs"."policy_version" = EXCLUDED."policy_version"
             AND "media_probe_jobs"."deletion_fence" = EXCLUDED."deletion_fence"
             AND "media_probe_jobs"."full_pipeline_job_id" = EXCLUDED."full_pipeline_job_id"
             AND "media_probe_jobs"."source_bucket" = EXCLUDED."source_bucket"
             AND "media_probe_jobs"."source_key" = EXCLUDED."source_key"
             AND "media_probe_jobs"."source_version_id" = EXCLUDED."source_version_id"
             AND "media_probe_jobs"."source_etag" = EXCLUDED."source_etag"
             AND "media_probe_jobs"."source_content_length" = EXCLUDED."source_content_length"
         RETURNING "id"`,
        [
          command.documentId,
          command.ownerId,
          command.correlationId,
          command.probeGeneration,
          command.policyVersion,
          command.deletionFence,
          command.fullPipelineJobId,
          command.sourceBucket,
          command.sourceKey,
          sourceVersionId,
          sourceEtag,
          command.sourceContentLength,
          idempotencyKey,
        ],
      );
      if (rows.length === 1) return;
      throw new Error('Media probe idempotency conflict');
    });
  }

  async cancelDocument(command: DocumentCancellationCommand): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockDocument(manager, command.documentId, command.ownerId);

      const eventIdempotencyKey = `document-cancel:${command.documentId}:${command.deletionFence}:MEDIA_PROBE`;
      await manager.query(
        `INSERT INTO "ai"."media_probe_cancellation_tombstones"
           ("document_id", "owner_id", "deletion_fence", "reason", "event_idempotency_key")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          command.documentId,
          command.ownerId,
          command.deletionFence,
          command.reason,
          eventIdempotencyKey,
        ],
      );

      await manager.query(
        `UPDATE "ai"."media_probe_jobs"
         SET "status" = 'CANCELLED',
             "lease_id" = NULL,
             "lease_until" = NULL,
             "updated_at" = now()
         WHERE "document_id" = $1
           AND "owner_id" = $2
           AND "deletion_fence" <= $3
           AND "status" IN ('PENDING', 'RUNNING')`,
        [command.documentId, command.ownerId, command.deletionFence],
      );
    });
  }

  /** Serialize enqueue and cancellation for the same Document/Owner pair. */
  private async lockDocument(
    manager: EntityManager,
    documentId: string,
    ownerId: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
      [`media-probe:${documentId}:${ownerId}`],
    );
  }
}
