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

  async function seedManifest(
    status: DocumentPurgeManifestStatus,
    nextAttemptOffsetSeconds: number,
  ): Promise<void> {
    const documentId = randomUUID();
    await manifests.save(manifests.create({
      deletionFence: 1,
      documentId,
      idempotencyKey: `document-purge:${documentId}:1`,
      locators: [],
      nextAttemptAt: new Date(Date.now() + nextAttemptOffsetSeconds * 1_000),
      ownerId: randomUUID(),
      status,
    }));
  }

  it('reports zero for an empty queue', async () => {
    const actualBacklog = await repository.summarizeBacklog();

    expect(actualBacklog).toEqual({ failedCount: 0, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });

  it('counts PENDING and FAILED and ages the longest-due manifest', async () => {
    await seedManifest(DocumentPurgeManifestStatus.PENDING, -120);
    await seedManifest(DocumentPurgeManifestStatus.FAILED, -SECONDS_PER_HOUR - 30);
    await seedManifest(DocumentPurgeManifestStatus.FAILED, -10);

    const actualBacklog = await repository.summarizeBacklog();

    expect(actualBacklog.pendingCount).toBe(1);
    expect(actualBacklog.failedCount).toBe(2);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(SECONDS_PER_HOUR + 30);
    expect(actualBacklog.oldestPendingAgeSeconds).toBeLessThan(SECONDS_PER_HOUR + 60);
  });

  it('does not age a manifest still inside its retry backoff', async () => {
    await seedManifest(DocumentPurgeManifestStatus.FAILED, 600);

    const actualBacklog = await repository.summarizeBacklog();

    expect(actualBacklog).toEqual({ failedCount: 1, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });

  it('ignores RUNNING, COMPLETED and DEAD_LETTER manifests', async () => {
    await seedManifest(DocumentPurgeManifestStatus.RUNNING, -SECONDS_PER_HOUR * 2);
    await seedManifest(DocumentPurgeManifestStatus.COMPLETED, -SECONDS_PER_HOUR * 2);
    await seedManifest(DocumentPurgeManifestStatus.DEAD_LETTER, -SECONDS_PER_HOUR * 2);

    const actualBacklog = await repository.summarizeBacklog();

    expect(actualBacklog).toEqual({ failedCount: 0, oldestPendingAgeSeconds: 0, pendingCount: 0 });
  });
});
