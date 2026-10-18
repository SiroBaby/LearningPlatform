import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import {
  DocumentPurgeLocator,
  DocumentPurgeManifest,
} from '../entities/document-purge-manifest.entity';
import { DocumentPurgeErrorCode } from '../enums/document-purge-error-code.enum';
import { DocumentPurgeManifestStatus } from '../enums/document-purge-manifest-status.enum';

/** A manifest leased to one purge worker; every write must present `leaseId`. */
export interface ClaimedDocumentPurgeManifest {
  readonly id: string;
  readonly documentId: string;
  readonly ownerId: string;
  readonly attempts: number;
  readonly leaseId: string;
  readonly locators: readonly DocumentPurgeLocator[];
}

export interface ClaimDocumentPurgeManifests {
  readonly limit: number;
  readonly leaseMs: number;
}

export interface DocumentPurgeReferenceQuery {
  readonly documentId: string;
  readonly locators: readonly DocumentPurgeLocator[];
  readonly mediaBucket: string;
  readonly documentsBucket: string;
}

export interface RenewDocumentPurgeLease {
  readonly id: string;
  readonly leaseId: string;
  readonly leaseMs: number;
}

export interface ScheduleDocumentPurgeRetry {
  readonly id: string;
  readonly leaseId: string;
  readonly errorCode: DocumentPurgeErrorCode;
  readonly delayMs: number;
}

export interface DeadLetterDocumentPurge {
  readonly id: string;
  readonly leaseId: string;
  readonly errorCode: DocumentPurgeErrorCode;
}

/**
 * Work queue depth for monitoring. `oldestPendingAgeSeconds` is the age
 * (`now() - created_at`) of the oldest unfinished manifest: PENDING, FAILED
 * (including one inside its retry backoff) or RUNNING with an expired lease.
 * A RUNNING manifest with a live lease is being worked on and is not counted;
 * 0 when nothing is unfinished.
 */
export interface DocumentPurgeBacklog {
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly oldestPendingAgeSeconds: number;
}

interface BacklogRow {
  readonly pending_count: string | number;
  readonly failed_count: string | number;
  readonly oldest_pending_age_seconds: string | number | null;
}

interface ClaimedManifestRow {
  readonly id: string;
  readonly document_id: string;
  readonly owner_id: string;
  readonly attempts: number;
  readonly lease_id: string;
  readonly locators: DocumentPurgeLocator[];
}

/** Lease predicate shared by every terminal or retry write. */
const ACTIVE_LEASE_PREDICATE = `"id" = $1
  AND "lease_id" = $2
  AND "status" = 'RUNNING'
  AND "lease_until" > now()`;

/**
 * TypeORM returns SELECT rows as an array but UPDATE ... RETURNING as a
 * `[rows, affectedCount]` tuple; some drivers expose `{ rows }`.
 */
function queryRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      return result[0] as T[];
    }
    return result as T[];
  }
  if (result && typeof result === 'object' && Array.isArray((result as { readonly rows?: unknown }).rows)) {
    return (result as { readonly rows: T[] }).rows;
  }
  return [];
}

/**
 * Persistence for the document purge worker. The `locators` column is never
 * updated here: it is the immutable list of versions captured at deletion.
 */
@Injectable()
export class DocumentPurgeRepository extends BaseRepository<DocumentPurgeManifest> {
  constructor(private readonly dataSource: DataSource) {
    super(DocumentPurgeManifest, dataSource);
  }

  /**
   * Leases due PENDING/FAILED manifests and RUNNING manifests whose lease
   * expired (crashed worker). Each claim counts as one attempt so a worker
   * that keeps crashing still reaches the attempt cap.
   */
  async claimDue(input: ClaimDocumentPurgeManifests): Promise<ClaimedDocumentPurgeManifest[]> {
    const rows = queryRows<ClaimedManifestRow>(await this.dataSource.query(
      `WITH "due" AS (
         SELECT "id"
           FROM "course"."document_purge_manifests"
          WHERE ("status" IN ('PENDING', 'FAILED') AND "next_attempt_at" <= now())
             OR ("status" = 'RUNNING' AND "lease_until" <= now())
          ORDER BY "next_attempt_at", "created_at", "id"
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE "course"."document_purge_manifests" AS "manifest"
          SET "status" = 'RUNNING',
              "attempts" = "manifest"."attempts" + 1,
              "lease_id" = gen_random_uuid(),
              "lease_until" = now() + ($2::bigint * interval '1 millisecond'),
              "updated_at" = now()
         FROM "due"
        WHERE "manifest"."id" = "due"."id"
       RETURNING "manifest"."id", "manifest"."document_id", "manifest"."owner_id",
                 "manifest"."attempts", "manifest"."lease_id", "manifest"."locators"`,
      [input.limit, input.leaseMs],
    ));
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      ownerId: row.owner_id,
      attempts: Number(row.attempts),
      leaseId: row.lease_id,
      locators: row.locators,
    }));
  }

  /**
   * Read-only summary of unfinished manifests. The statement runs inside a
   * transaction with a local `statement_timeout`, so a stuck query cannot
   * hold a connection forever.
   */
  async summarizeBacklog(timeoutMs: number): Promise<DocumentPurgeBacklog> {
    const [row] = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('statement_timeout', $1, true)`, [String(timeoutMs)]);
      return queryRows<BacklogRow>(await manager.query(
        `SELECT count(*) FILTER (WHERE "status" = $1) AS "pending_count",
                count(*) FILTER (WHERE "status" = $2) AS "failed_count",
                floor(extract(epoch FROM now() - min("created_at"))) AS "oldest_pending_age_seconds"
           FROM "course"."document_purge_manifests"
          WHERE "status" IN ($1, $2)
             OR ("status" = $3 AND "lease_until" <= now())`,
        [
          DocumentPurgeManifestStatus.PENDING,
          DocumentPurgeManifestStatus.FAILED,
          DocumentPurgeManifestStatus.RUNNING,
        ],
      ));
    });
    return {
      pendingCount: Number(row.pending_count),
      failedCount: Number(row.failed_count),
      oldestPendingAgeSeconds: Number(row.oldest_pending_age_seconds ?? 0),
    };
  }

  /**
   * True when another Document that is not being deleted still points at a
   * bucket/key in the manifest. The bucket of a Document follows its type.
   */
  async hasActiveReference(input: DocumentPurgeReferenceQuery): Promise<boolean> {
    if (input.locators.length === 0) return false;
    const rows = queryRows<{ readonly referenced: boolean }>(await this.dataSource.query(
      `SELECT EXISTS (
         SELECT 1
           FROM "course"."documents" AS "document"
           JOIN unnest($2::text[], $3::text[]) AS "locator" ("bucket", "key")
             ON "document"."storage_ref" = "locator"."key"
          WHERE "document"."id" <> $1
            AND "document"."status" <> 'DELETING'
            AND "locator"."bucket" = CASE
                  WHEN "document"."type" IN ('AUDIO', 'VIDEO') THEN $4
                  ELSE $5
                END
       ) AS "referenced"`,
      [
        input.documentId,
        input.locators.map((locator) => locator.bucket),
        input.locators.map((locator) => locator.key),
        input.mediaBucket,
        input.documentsBucket,
      ],
    ));
    return rows[0]?.referenced === true;
  }

  /**
   * Extends a lease that is still held and unexpired, so a long manifest
   * never outlives its lease. Returns false when the lease was lost.
   */
  async renewLease(input: RenewDocumentPurgeLease): Promise<boolean> {
    const rows = queryRows<{ readonly id: string }>(await this.dataSource.query(
      `UPDATE "course"."document_purge_manifests"
          SET "lease_until" = now() + ($3::bigint * interval '1 millisecond'),
              "updated_at" = now()
        WHERE ${ACTIVE_LEASE_PREDICATE}
        RETURNING "id"`,
      [input.id, input.leaseId, input.leaseMs],
    ));
    return rows.length === 1;
  }

  /** Returns false when the lease was lost; nothing is written then. */
  async complete(id: string, leaseId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ readonly document_id: string }>(await manager.query(
        `UPDATE "course"."document_purge_manifests"
            SET "status" = 'COMPLETED',
                "purged_at" = now(),
                "lease_id" = NULL,
                "lease_until" = NULL,
                "last_error_code" = NULL,
                "last_error_message" = NULL,
                "updated_at" = now()
          WHERE ${ACTIVE_LEASE_PREDICATE}
          RETURNING "document_id"`,
        [id, leaseId],
      ));
      if (rows.length !== 1) return false;
      await this.markPurgeRequestPublished(manager, rows[0].document_id, id);
      return true;
    });
  }

  /** Releases the lease and makes the manifest claimable after `delayMs`. */
  async scheduleRetry(input: ScheduleDocumentPurgeRetry): Promise<boolean> {
    const rows = queryRows<{ readonly id: string }>(await this.dataSource.query(
      `UPDATE "course"."document_purge_manifests"
          SET "status" = 'FAILED',
              "next_attempt_at" = now() + ($4::bigint * interval '1 millisecond'),
              "last_error_code" = $3,
              "last_error_message" = NULL,
              "lease_id" = NULL,
              "lease_until" = NULL,
              "updated_at" = now()
        WHERE ${ACTIVE_LEASE_PREDICATE}
        RETURNING "id"`,
      [input.id, input.leaseId, input.errorCode, input.delayMs],
    ));
    return rows.length === 1;
  }

  /** Terminal stop for owner action; also settles the purge outbox event. */
  async deadLetter(input: DeadLetterDocumentPurge): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ readonly document_id: string }>(await manager.query(
        `UPDATE "course"."document_purge_manifests"
            SET "status" = 'DEAD_LETTER',
                "dead_lettered_at" = now(),
                "last_error_code" = $3,
                "last_error_message" = NULL,
                "lease_id" = NULL,
                "lease_until" = NULL,
                "updated_at" = now()
          WHERE ${ACTIVE_LEASE_PREDICATE}
          RETURNING "document_id"`,
        [input.id, input.leaseId, input.errorCode],
      ));
      if (rows.length !== 1) return false;
      await this.markPurgeRequestPublished(manager, rows[0].document_id, input.id);
      return true;
    });
  }

  /**
   * The manifest table is the purge work queue; the outbox event only needs
   * to stop looking pending once the manifest reaches a terminal state.
   */
  private async markPurgeRequestPublished(
    manager: EntityManager,
    documentId: string,
    manifestId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE "course"."outbox"
          SET "published_at" = now()
        WHERE "aggregate_id" = $1
          AND "event_type" = 'DocumentPurgeRequested'
          AND "payload" ->> 'purgeManifestId' = $2
          AND "published_at" IS NULL`,
      [documentId, manifestId],
    );
  }
}
