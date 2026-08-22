import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BudgetExhaustedError } from '../../ai/budget-exhausted.error';
import type { BudgetReservationPort } from '../contracts/budget-reservation.port';

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
      const settleKey = `settle:${input.jobId}:${input.attempt}`;
      if ((await manager.query<readonly { readonly id: string }[]>('SELECT "id" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1', [settleKey])).length > 0) return;
      const reserve = await manager.query<readonly { readonly credits: string }[]>('SELECT "credits" FROM "course"."credit_ledger_entries" WHERE "business_key" = $1', [`reserve:${input.jobId}:${input.attempt}`]);
      const reserved = Number(reserve[0]?.credits ?? 0);
      const released = input.hasUncertainDispatch ? 0 : Math.max(0, reserved - input.knownActualCredits);
      const held = input.hasUncertainDispatch ? Math.max(0, reserved - input.knownActualCredits) : 0;
      await manager.query('INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, $5, $6)', [input.ownerId, input.jobId, input.attempt, settleKey, 'SETTLE', input.knownActualCredits]);
      await manager.query('INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, $5, $6)', [input.ownerId, input.jobId, input.attempt, `release:${input.jobId}:${input.attempt}`, 'RELEASE', released]);
      if (held > 0) await manager.query('INSERT INTO "course"."credit_ledger_entries" ("owner_id", "job_id", "job_attempt", "business_key", "entry_type", "credits") VALUES ($1, $2, $3, $4, $5, $6)', [input.ownerId, input.jobId, input.attempt, `hold:${input.jobId}:${input.attempt}`, 'HOLD', held]);
      await manager.query('UPDATE "course"."owner_credit_wallets" SET "reserved_credits" = "reserved_credits" - $2, "available_credits" = "available_credits" + $3 - $4, "updated_at" = now() WHERE "owner_id" = $1', [input.ownerId, reserved, released, Math.max(0, input.knownActualCredits - reserved)]);
    });
  }
}
