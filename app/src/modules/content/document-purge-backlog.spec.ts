import { randomUUID } from 'crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource, Repository } from 'typeorm';

import { createTestDataSource } from '../../test-support/test-data-source';
import { startTestDb, TestDb } from '../../test-support/test-db';
import { clearDocumentFlowData } from '../../../test/support/test-database-cleanup';
import { DocumentPurgeManifest } from './entities/document-purge-manifest.entity';
import { DocumentPurgeManifestStatus } from './enums/document-purge-manifest-status.enum';
import { DocumentPurgeRepository } from './repositories/document-purge.repository';

const SECONDS_PER_HOUR = 3_600;
const READ_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 200;

interface SeedManifestInput {
  readonly status: DocumentPurgeManifestStatus;
  readonly createdAgeSeconds: number;
  readonly leaseUntilOffsetSeconds?: number;
  readonly nextAttemptOffsetSeconds?: number;
}

describe('DocumentPurgeRepository.summarizeBacklog (PostgreSQL)', () => {
  let db: TestDb;
  let dataSource: DataSource;
  let manifests: Repository<DocumentPurgeManifest>;
  let repository: DocumentPurgeRepository;

  beforeAll(async () => {
    db = await startTestDb();
    dataSource = await createTestDataSource(db.container);
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await db?.stop();
  });

  beforeEach(async () => {
    manifests = dataSource.getRepository(DocumentPurgeManifest);
    repository = new DocumentPurgeRepository(dataSource);
    await clearDocumentFlowData(db.client);
  });

  async function seedManifest(input: SeedManifestInput): Promise<void> {
    const documentId = randomUUID();
    const saved = await manifests.save(manifests.create({
      deletionFence: 1,
      documentId,
      idempotencyKey: `document-purge:${documentId}:1`,
      locators: [],
      nextAttemptAt: new Date(Date.now() + (input.nextAttemptOffsetSeconds ?? -1) * 1_000),
      ownerId: randomUUID(),
      status: input.status,
    }));
    await db.client.query(
      `UPDATE "course"."document_purge_manifests"
          SET "created_at" = now() - ($2::bigint * interval '1 second'),
              "lease_until" = CASE WHEN $3::bigint IS NULL THEN NULL
                                   ELSE now() + ($3::bigint * interval '1 second') END
        WHERE "id" = $1`,
      [saved.id, input.createdAgeSeconds, input.leaseUntilOffsetSeconds ?? null],
    );
  }

  it('reports zero for an empty queue', async () => {
    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog).toEqual({ failedCount: 0, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });

  it('counts PENDING and FAILED and ages the oldest manifest by created_at', async () => {
    await seedManifest({ createdAgeSeconds: 120, status: DocumentPurgeManifestStatus.PENDING });
    await seedManifest({ createdAgeSeconds: SECONDS_PER_HOUR + 30, status: DocumentPurgeManifestStatus.FAILED });
    await seedManifest({ createdAgeSeconds: 10, status: DocumentPurgeManifestStatus.FAILED });

    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog.pendingCount).toBe(1);
    expect(actualBacklog.failedCount).toBe(2);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(SECONDS_PER_HOUR + 30);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeLessThan(SECONDS_PER_HOUR + 60);
  });

  it('still counts a FAILED manifest that is retrying over an hour after creation', async () => {
    await seedManifest({
      createdAgeSeconds: SECONDS_PER_HOUR * 2,
      nextAttemptOffsetSeconds: 600,
      status: DocumentPurgeManifestStatus.FAILED,
    });

    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog.failedCount).toBe(1);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(SECONDS_PER_HOUR * 2);
  });

  it('ignores RUNNING manifests whose lease is still valid', async () => {
    await seedManifest({
      createdAgeSeconds: SECONDS_PER_HOUR * 2,
      leaseUntilOffsetSeconds: 120,
      status: DocumentPurgeManifestStatus.RUNNING,
    });

    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog).toEqual({ failedCount: 0, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });

  it('ages a RUNNING manifest whose lease expired without counting it as PENDING or FAILED', async () => {
    await seedManifest({
      createdAgeSeconds: SECONDS_PER_HOUR * 2,
      leaseUntilOffsetSeconds: -30,
      status: DocumentPurgeManifestStatus.RUNNING,
    });

    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog.pendingCount).toBe(0);
    expect(actualBacklog.failedCount).toBe(0);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(SECONDS_PER_HOUR * 2);
  });

  it('ignores COMPLETED and DEAD_LETTER manifests', async () => {
    await seedManifest({ createdAgeSeconds: SECONDS_PER_HOUR * 2, status: DocumentPurgeManifestStatus.COMPLETED });
    await seedManifest({ createdAgeSeconds: SECONDS_PER_HOUR * 2, status: DocumentPurgeManifestStatus.DEAD_LETTER });

    const actualBacklog = await repository.summarizeBacklog(READ_TIMEOUT_MS);

    expect(actualBacklog).toEqual({ failedCount: 0, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });

  it('gives up with a statement timeout instead of waiting on a locked table', async () => {
    await db.client.query('BEGIN');
    try {
      await db.client.query('LOCK TABLE "course"."document_purge_manifests" IN ACCESS EXCLUSIVE MODE');

      await expect(repository.summarizeBacklog(LOCK_TIMEOUT_MS)).rejects.toThrow(/statement timeout/);
    } finally {
      await db.client.query('ROLLBACK');
    }
  });
});
