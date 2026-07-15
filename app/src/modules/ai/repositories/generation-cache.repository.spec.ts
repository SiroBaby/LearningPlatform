import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';

import type { GenerationCacheEntry } from '../contracts/generation-cache.contracts';
import { createTestDataSource } from '../../../test-support/test-data-source';
import { startTestDb, type TestDb } from '../../../test-support/test-db';
import { GenerationCacheRepository } from './generation-cache.repository';

describe('GenerationCacheRepository', () => {
  let cache: GenerationCacheRepository;
  let dataSource: DataSource;
  let db: TestDb;

  beforeAll(async () => { db = await startTestDb(); });
  afterAll(async () => { await db?.stop(); });
  beforeEach(async () => {
    dataSource = await createTestDataSource(db.container);
    cache = new GenerationCacheRepository(dataSource);
    await db.client.query('TRUNCATE "ai"."generation_cache"');
  });
  afterEach(async () => { await dataSource?.destroy(); });

  it('keeps the first decoded output for a content-addressed key', async () => {
    const entry = cacheEntry('Correct');

    await cache.saveDecodedOutput(entry);
    await cache.saveDecodedOutput(cacheEntry('Changed'));

    expect(await cache.findDecodedOutput(entry.cacheKey)).toEqual(entry.output);
  });

  it('rejects malformed cached JSON at the database boundary', async () => {
    const entry = cacheEntry('Correct');
    await dataSource.query(
      `INSERT INTO "ai"."generation_cache"
        ("cache_key", "model", "prompt_fingerprint", "parameters", "output")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.cacheKey,
        entry.model,
        entry.promptFingerprint,
        entry.parameters,
        { questions: [{ stem: 'missing fields' }] },
      ],
    );

    await expect(cache.findDecodedOutput(entry.cacheKey)).rejects.toMatchObject({
      code: 'GENERATION_OUTPUT_INVALID',
    });
  });
});

function cacheEntry(answer: string): GenerationCacheEntry {
  return {
    cacheKey: 'a'.repeat(64),
    model: 'fake-llm-v1',
    output: {
      questions: [{
        explanation: 'Grounded explanation',
        options: [
          { content: answer, isCorrect: true },
          { content: 'Incorrect', isCorrect: false },
        ],
        stem: 'What is supported?',
      }],
    },
    parameters: { format: 'mcq-single-select-v1', maxOutputTokens: 1000, questionsPerChunk: 1 },
    promptFingerprint: 'b'.repeat(64),
  };
}
