import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BaseRepository } from '../../../database/base.repository';
import type {
  PromptVersionEntry,
  PromptVersionStore,
} from '../contracts/prompt-version.contracts';
import { PromptVersion } from '../entities/prompt-version.entity';

@Injectable()
export class PromptVersionRepository extends BaseRepository<PromptVersion> implements PromptVersionStore {
  constructor(dataSource: DataSource) {
    super(PromptVersion, dataSource);
  }

  async record(entry: PromptVersionEntry): Promise<void> {
    await this.query(
      `INSERT INTO "ai"."prompt_versions" (
        "fingerprint", "model", "parameters", "template"
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT ("fingerprint") DO NOTHING`,
      [entry.fingerprint, entry.model, entry.parameters, entry.template],
    );
  }
}
