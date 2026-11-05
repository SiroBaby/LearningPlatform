import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import { DocumentPurgeManifest } from '../entities/document-purge-manifest.entity';

/** Fixed advisory-lock name; one scanner runs per database at a time. */
const ORPHAN_SCANNER_LOCK_NAME = 'media-orphan-scanner';

/** Held until `release`; the lock lives on one dedicated connection. */
export interface MediaOrphanScanLock {
  release(): Promise<void>;
}

/** Keys and versions the scanner must never delete. */
export interface MediaObjectProtections {
  /** Every version of these keys is protected. */
  readonly protectedKeys: ReadonlySet<string>;
  /** Only these `key + versionId` pairs are protected. */
  readonly protectedVersions: ReadonlySet<string>;
}

interface ProtectionRow {
  readonly key: string;
  readonly version_id: string | null;
}

export function mediaVersionProtectionKey(key: string, versionId: string): string {
  return `${key}\u0000${versionId}`;
}

/**
 * Read-only reference lookups for the media orphan scanner, plus the
 * single-runner lock. It never writes to `course` tables.
 */
@Injectable()
export class MediaOrphanReferenceRepository extends BaseRepository<DocumentPurgeManifest> {
  constructor(private readonly dataSource: DataSource) {
    super(DocumentPurgeManifest, dataSource);
  }

  /**
   * Session-level advisory lock on a dedicated connection, so a second pod
   * (or a stale one) skips the cycle instead of listing in parallel. Returns
   * `null` when another runner holds it. The lock disappears with its
   * connection if the process dies.
   */
  async tryAcquireScanLock(): Promise<MediaOrphanScanLock | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS "acquired"`,
        [ORPHAN_SCANNER_LOCK_NAME],
      )) as Array<{ readonly acquired: boolean }>;
      if (rows[0]?.acquired !== true) {
        await runner.release();
        return null;
      }
    } catch (error) {
      await runner.release();
      throw error;
    }
    return {
      release: async (): Promise<void> => {
        try {
          await runner.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [ORPHAN_SCANNER_LOCK_NAME]);
        } finally {
          await runner.release();
        }
      },
    };
  }

  /**
   * Which of `keys` (media bucket) are still referenced:
   *  - a Document that is not `DELETING` protects every version of its key;
   *  - a `DELETING` tombstone protects its key until its manifest is
   *    `COMPLETED`; a manifest that finished leaves versions outside the
   *    manifest to the scanner (Q1);
   *  - an unfinished manifest locator protects its key (no VersionId, or still
   *    PENDING/FAILED/RUNNING) or exactly its version (DEAD_LETTER).
   */
  async findProtections(keys: readonly string[], mediaBucket: string): Promise<MediaObjectProtections> {
    if (keys.length === 0) return { protectedKeys: new Set(), protectedVersions: new Set() };
    const rows = queryRows<ProtectionRow>(await this.dataSource.query(
      `SELECT "document"."storage_ref" AS "key", NULL::text AS "version_id"
         FROM "course"."documents" AS "document"
         LEFT JOIN "course"."document_purge_manifests" AS "manifest"
           ON "manifest"."document_id" = "document"."id"
        WHERE "document"."storage_ref" = ANY($1::text[])
          AND ("document"."status" <> 'DELETING'
               OR "manifest"."id" IS NULL
               OR "manifest"."status" IN ('PENDING', 'FAILED', 'RUNNING'))
       UNION
       SELECT "locator"."key" AS "key",
              CASE WHEN "manifest"."status" IN ('PENDING', 'FAILED', 'RUNNING')
                   THEN NULL ELSE "locator"."versionId" END AS "version_id"
         FROM "course"."document_purge_manifests" AS "manifest"
        CROSS JOIN LATERAL jsonb_to_recordset("manifest"."locators")
              AS "locator" ("bucket" text, "key" text, "versionId" text)
        WHERE "manifest"."status" <> 'COMPLETED'
          AND "locator"."bucket" = $2
          AND "locator"."key" = ANY($1::text[])`,
      [[...keys], mediaBucket],
    ));
    const protectedKeys = new Set<string>();
    const protectedVersions = new Set<string>();
    for (const row of rows) {
      if (row.version_id === null) protectedKeys.add(row.key);
      else protectedVersions.add(mediaVersionProtectionKey(row.key, row.version_id));
    }
    return { protectedKeys, protectedVersions };
  }
}

/** `DataSource.query` returns an array, a `[rows, count]` tuple or `{ rows }` by driver. */
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
