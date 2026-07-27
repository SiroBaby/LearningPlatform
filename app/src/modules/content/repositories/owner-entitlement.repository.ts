import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { OwnerEntitlements } from '../contracts/owner-entitlement.port';

@Injectable()
export class OwnerEntitlementRepository implements OwnerEntitlements {
  constructor(private readonly dataSource: DataSource) {}

  async findOrCreate(ownerId: string, initialCredits: number): Promise<{ readonly planId: string }> {
    const rows = await this.dataSource.query<readonly { readonly planId: string }[]>(
      `INSERT INTO "course"."owner_entitlements" ("owner_id", "plan_id") VALUES ($1, 'free')
       ON CONFLICT ("owner_id") DO UPDATE SET "updated_at" = now() RETURNING "plan_id" AS "planId"`,
      [ownerId],
    );
    await this.dataSource.query(
      'INSERT INTO "course"."owner_credit_wallets" ("owner_id", "available_credits") VALUES ($1, $2) ON CONFLICT ("owner_id") DO NOTHING',
      [ownerId, initialCredits],
    );
    const entitlement = rows[0];
    if (!entitlement) throw new Error('Owner entitlement could not be created');
    return entitlement;
  }
}
