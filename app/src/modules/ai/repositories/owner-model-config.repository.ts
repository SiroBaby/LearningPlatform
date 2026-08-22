import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { Inject } from '@nestjs/common';
import { CREDENTIAL_CIPHER } from '../contracts/credential-cipher.contract';
import type {
  CustomModelConfiguration,
  EncryptedCustomModelConfiguration,
  OwnerModelConfigStore,
  PublicModelCatalogItem,
} from '../contracts/model-selection.contracts';

@Injectable()
export class OwnerModelConfigRepository implements OwnerModelConfigStore {
  constructor(private readonly dataSource: DataSource, @Inject(CREDENTIAL_CIPHER) private readonly cipher: { encrypt(plaintext: string): string }) {}

  async create(input: Omit<CustomModelConfiguration, 'id'> & { readonly displayName: string }): Promise<string> {
    const id = randomUUID();
    await this.dataSource.query(
      `
      INSERT INTO "ai"."owner_model_configs"
        ("id", "owner_id", "display_name", "base_url", "model", "capability_version", "transport", "structured_output_mode", "api_key_ciphertext")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [id, input.ownerId, input.displayName, input.baseUrl, input.model, input.capabilityVersion, input.transport, input.structuredOutputMode, this.cipher.encrypt(input.apiKey)],
    );
    return id;
  }

  async findActiveForOwner(ownerId: string, id: string): Promise<EncryptedCustomModelConfiguration | null> {
    const rows = await this.dataSource.query<readonly EncryptedCustomModelConfiguration[]>(
      `
      SELECT "id", "owner_id" AS "ownerId", "base_url" AS "baseUrl", "model", "capability_version" AS "capabilityVersion",
             "transport", "structured_output_mode" AS "structuredOutputMode", "api_key_ciphertext" AS "apiKeyCiphertext"
      FROM "ai"."owner_model_configs"
      WHERE "id" = $1 AND "owner_id" = $2 AND "is_active" = true
      `,
      [id, ownerId],
    );
    return rows[0] ?? null;
  }

  async listForOwner(ownerId: string): Promise<readonly PublicModelCatalogItem[]> {
    return this.dataSource.query<readonly PublicModelCatalogItem[]>(
      `
      SELECT "id", 'CUSTOM'::text AS "kind", "display_name" AS "label"
      FROM "ai"."owner_model_configs"
      WHERE "owner_id" = $1 AND "is_active" = true
      ORDER BY "created_at" DESC
      `,
      [ownerId],
    );
  }

  async revoke(ownerId: string, id: string): Promise<boolean> {
    const result = await this.dataSource.query<readonly { readonly id: string }[]>(
      `UPDATE "ai"."owner_model_configs" SET "is_active" = false, "updated_at" = now()
       WHERE "id" = $1 AND "owner_id" = $2 AND "is_active" = true RETURNING "id"`,
      [id, ownerId],
    );
    return result.length === 1;
  }
}
