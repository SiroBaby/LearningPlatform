import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { ProviderUsageStore, ProviderUsage } from '../contracts/cost-guard.contracts';

@Injectable()
export class ProviderUsageRepository implements ProviderUsageStore {
  constructor(private readonly dataSource: DataSource) {}

  async recordUsage(input: {
    readonly attempt: number;
    readonly cached: boolean;
    readonly chargedCredits: number | null;
    readonly jobId: string;
    readonly ownerId: string;
    readonly providerIdentity: string;
    readonly requestKey: string;
    readonly usage: ProviderUsage;
  }): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "ai"."provider_usage_records"
        ("owner_id", "job_id", "job_attempt", "request_key", "provider_identity", "input_tokens", "output_tokens", "cached", "usage_status", "charged_credits")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ("request_key") DO UPDATE
         SET "input_tokens" = EXCLUDED."input_tokens", "output_tokens" = EXCLUDED."output_tokens",
             "usage_status" = EXCLUDED."usage_status", "charged_credits" = EXCLUDED."charged_credits"
       WHERE "ai"."provider_usage_records"."usage_status" = 'UNAVAILABLE' AND EXCLUDED."usage_status" = 'AVAILABLE'`,
      [input.ownerId, input.jobId, input.attempt, input.requestKey, input.providerIdentity, input.usage.inputTokens, input.usage.outputTokens, input.cached, input.usage.status, input.chargedCredits],
    );
  }

  async summarizeUsage(input: {
    readonly attempt: number;
    readonly jobId: string;
    readonly ownerId: string;
  }): Promise<{ readonly hasUncertainDispatch: boolean; readonly knownActualCredits: number }> {
    const rows = await this.dataSource.query<readonly { readonly hasUncertainDispatch: boolean; readonly knownActualCredits: string }[]>(
      `
      SELECT COALESCE(bool_or(NOT "cached" AND "usage_status" = 'UNAVAILABLE'), false) AS "hasUncertainDispatch",
             COALESCE(sum("charged_credits"), 0) AS "knownActualCredits"
      FROM "ai"."provider_usage_records"
      WHERE "owner_id" = $1 AND "job_id" = $2 AND "job_attempt" = $3
      `,
      [input.ownerId, input.jobId, input.attempt],
    );
    const summary = rows[0];
    return {
      hasUncertainDispatch: summary?.hasUncertainDispatch ?? false,
      knownActualCredits: Number(summary?.knownActualCredits ?? 0),
    };
  }

}
