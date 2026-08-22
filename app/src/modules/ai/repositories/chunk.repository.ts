import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ApplicationConfigService } from '../../../config/application-config.service';
import { BaseRepository } from '../../../database/base.repository';
import type { ChunkRecord, ChunkStore, ReplaceDocumentChunks } from '../contracts/chunk.contracts';
import { Chunk } from '../entities/chunk.entity';

@Injectable()
export class ChunkRepository extends BaseRepository<Chunk> implements ChunkStore {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly config?: ApplicationConfigService,
  ) {
    super(Chunk, dataSource);
  }

  async replaceForDocument(input: ReplaceDocumentChunks): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const activeJobs: Array<{ readonly id: string }> = await manager.query(
        `SELECT "id" FROM "ai"."processing_jobs"
         WHERE "id" = $1 AND "attempts" = $2 AND "lease_id" = $3 AND "status" = 'RUNNING'
           AND "lease_until" > now() AND "document_id" = $4 AND "owner_id" = $5
         FOR UPDATE`,
        [input.jobId, input.attempt, input.leaseId, input.documentId, input.ownerId],
      );
      if (
        activeJobs.length !== 1
      ) {
        return false;
      }
      await manager.query(
        'DELETE FROM "ai"."chunks" WHERE "document_id" = $1 AND "owner_id" = $2',
        [input.documentId, input.ownerId],
      );
      const batchSize = this.chunkInsertBatchSize;
      for (let start = 0; start < input.chunks.length; start += batchSize) {
        await manager.insert(Chunk, input.chunks.slice(start, start + batchSize).map((chunk) => ({
          ...chunk,
          documentId: input.documentId,
          ownerId: input.ownerId,
          pageNumber: chunk.locator.kind === 'page' ? chunk.locator.page : null,
          startSec: null,
          endSec: null,
        })));
      }
      return true;
    });
  }

  private get chunkInsertBatchSize(): number {
    return this.config?.worker.chunkInsertBatchSize ?? 500;
  }

  async findForDocument(documentId: string, ownerId: string): Promise<readonly ChunkRecord[]> {
    const chunks = await this.find({
      where: { documentId, ownerId },
      order: { chunkIndex: 'ASC' },
    });
    return chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      contentHash: chunk.contentHash,
      id: chunk.id,
      locator: chunk.locator,
      text: chunk.text,
    }));
  }
}
