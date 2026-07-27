import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import type {
  GenerationCache,
  GenerationCacheEntry,
} from '../contracts/generation-cache.contracts';
import type { GeneratedQuestionOutput } from '../contracts/llm-provider.contracts';
import { GenerationCacheRecord } from '../entities/generation-cache.entity';
import { decodeGeneratedQuestionOutput } from '../quiz-generation-output.decoder';

@Injectable()
export class GenerationCacheRepository extends BaseRepository<GenerationCacheRecord> implements GenerationCache {
  constructor(dataSource: DataSource) {
    super(GenerationCacheRecord, dataSource);
  }

  async findDecodedOutput(cacheKey: string): Promise<GeneratedQuestionOutput | null> {
    const entry = await this.findOneBy({ cacheKey });
    return entry ? decodeGeneratedQuestionOutput(entry.output) : null;
  }

  async saveDecodedOutput(entry: GenerationCacheEntry): Promise<void> {
    await this.query(
      `INSERT INTO "ai"."generation_cache" (
        "cache_key", "model", "prompt_fingerprint", "parameters", "output"
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("cache_key") DO NOTHING`,
      [
        entry.cacheKey,
        entry.model,
        entry.promptFingerprint,
        entry.parameters,
        entry.output,
      ],
    );
  }
}
