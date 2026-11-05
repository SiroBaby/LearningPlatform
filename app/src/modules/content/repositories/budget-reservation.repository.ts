import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BudgetExhaustedError } from '../../ai/budget-exhausted.error';
import type { BudgetReservationPort } from '../contracts/budget-reservation.port';
import { settleReservation } from './credit-settlement';

@Injectable()
export class BudgetReservationRepository implements BudgetReservationPort {
  constructor(private readonly dataSource: DataSource) {}

  async reserve(input: { readonly attempt: number; readonly estimatedCredits: number; readonly jobId: string; readonly ownerId: string }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const key = `reserve:${input.jobId}:${input.attempt}`;
      if ((await manager.query<readonly { readonly id: string }[]>('SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1', [key])).length > 0) return;
      const wallet = await manager.query<readonly { readonly availableCredits: string }[]>('SELECT "available_credits" AS "availableCredits" FROM "course"."owner_credit_wallets" WHERE "owner_id" = $1 FOR UPDATE', [input.ownerId]);
      if (Number(wallet[0]?.availableCredits ?? 0) < input.estimatedCredits) throw new BudgetExhaustedError();
      await manager.query('UPDATE "course"."owner_credit_wallets" SET "available_credits" = "available_credits" - $2, "reserved_credits" = "reserved_credits" + $2, "updated_at" = now() WHERE "owner_id" = $1', [input.ownerId, input.estimatedCredits]);
      await manager.query('INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, $5, $6)', [input.ownerId, input.jobId, input.attempt, key, 'RESERVE', input.estimatedCredits]);
    });
  }

  async settle(input: { readonly attempt: number; readonly hasUncertainDispatch: boolean; readonly jobId: string; readonly knownActualCredits: number; readonly ownerId: string }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await settleReservation(manager, {
        hasUncertainDispatch: input.hasUncertainDispatch,
        jobId: input.jobId,
        knownActualCredits: input.knownActualCredits,
        ownerId: input.ownerId,
        processingAttempt: input.attempt,
      });
    });
  }
}
