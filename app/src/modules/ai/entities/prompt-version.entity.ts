import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { GenerationParameters } from '../contracts/llm-provider.contracts';

@Entity({ schema: 'ai', name: 'prompt_versions' })
export class PromptVersion {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 255 })
  model!: string;

  @Column({ type: 'jsonb' })
  parameters!: GenerationParameters;

  @Column({ type: 'text' })
  template!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
