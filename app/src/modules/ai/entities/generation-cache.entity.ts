import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type {
  GenerationParameters,
} from '../contracts/llm-provider.contracts';

@Entity({ schema: 'ai', name: 'generation_cache' })
export class GenerationCacheRecord {
  @PrimaryColumn({ name: 'cache_key', type: 'varchar', length: 64 })
  cacheKey!: string;

  @Column({ type: 'varchar', length: 255 })
  model!: string;

  @Column({ name: 'prompt_fingerprint', type: 'varchar', length: 64 })
  promptFingerprint!: string;

  @Column({ type: 'jsonb' })
  parameters!: GenerationParameters;

  @Column({ type: 'jsonb' })
  output!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
