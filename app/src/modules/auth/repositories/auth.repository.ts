import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';

import { BaseRepository } from '../../../database/base.repository';
import type { AuthSessionPair, GoogleIdentity } from '../contracts/google-auth.contracts';
import { OAuthTransaction } from '../entities/oauth-transaction.entity';
import { Session } from '../entities/session.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { User } from '../entities/user.entity';
import { AccountRole } from '../enums/account-role.enum';
import { AccountStatus } from '../enums/account-status.enum';
import { SessionTokenType } from '../enums/session-token-type.enum';
import { hashOAuthValue } from '../oauth-crypto';

interface OAuthTransactionRow {
  readonly id: string;
  readonly state_hash: string;
  readonly nonce_hash: string;
  readonly pkce_verifier_ciphertext: Buffer;
  readonly environment: string;
  readonly max_attempts: number;
  readonly attempt_count: number;
  readonly expires_at: Date;
  readonly processing_at: Date | null;
  readonly consumed_at: Date | null;
  readonly failed_at: Date | null;
  readonly created_at: Date;
}

function queryRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0]) && typeof result[1] === 'number') return result[0] as T[];
    return result as T[];
  }
  if (result && typeof result === 'object' && Array.isArray((result as { readonly rows?: unknown }).rows)) {
    return (result as { readonly rows: T[] }).rows;
  }
  return [];
}

function hydrateOAuthTransaction(row: OAuthTransactionRow): OAuthTransaction {
  return Object.assign(new OAuthTransaction(), {
    id: row.id,
    stateHash: row.state_hash,
    nonceHash: row.nonce_hash,
    pkceVerifierCiphertext: row.pkce_verifier_ciphertext,
    environment: row.environment,
    maxAttempts: row.max_attempts,
    attemptCount: row.attempt_count,
    expiresAt: row.expires_at,
    processingAt: row.processing_at,
    consumedAt: row.consumed_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
  });
}

@Injectable()
export class AuthRepository extends BaseRepository<User> {
  constructor(private readonly dataSource: DataSource) {
    super(User, dataSource);
  }

  async createOAuthTransaction(input: {
    readonly stateHash: string;
    readonly nonceHash: string;
    readonly pkceVerifierCiphertext: Buffer;
    readonly environment: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.dataSource.getRepository(OAuthTransaction).insert({
      attemptCount: 0,
      consumedAt: null,
      createdAt: new Date(),
      environment: input.environment,
      expiresAt: input.expiresAt,
      failedAt: null,
      maxAttempts: 5,
      nonceHash: input.nonceHash,
      pkceVerifierCiphertext: input.pkceVerifierCiphertext,
      processingAt: null,
      stateHash: input.stateHash,
    });
  }

  async beginOAuthExchange(stateHash: string, environment: string): Promise<OAuthTransaction | null> {
    return this.dataSource.transaction(async (manager) => {
      const rawResult = await manager.query(
        `UPDATE "auth"."oauth_transactions"
         SET "attempt_count" = "attempt_count" + 1,
             "processing_at" = now()
         WHERE "state_hash" = $1
           AND "environment" = $2
           AND "expires_at" > now()
           AND "processing_at" IS NULL
           AND "consumed_at" IS NULL
           AND "failed_at" IS NULL
           AND "attempt_count" < "max_attempts"
         RETURNING "id", "state_hash", "nonce_hash", "pkce_verifier_ciphertext", "environment",
                   "max_attempts", "attempt_count", "expires_at", "processing_at",
                   "consumed_at", "failed_at", "created_at"`,
        [stateHash, environment],
      );
      const result = queryRows<OAuthTransactionRow>(rawResult);
      const row = result[0];
      const id = row?.id;
      if (!id) {
        await manager.query(
          `UPDATE "auth"."oauth_transactions"
           SET "failed_at" = COALESCE("failed_at", now())
           WHERE "state_hash" = $1 AND "environment" = $2 AND "attempt_count" >= "max_attempts"`,
          [stateHash, environment],
        );
      }
      return row ? hydrateOAuthTransaction(row) : null;
    });
  }

  async markOAuthTransactionConsumed(id: string): Promise<void> {
    await this.dataSource.getRepository(OAuthTransaction).update(
      { id, consumedAt: IsNull(), failedAt: IsNull() },
      { consumedAt: new Date(), processingAt: null },
    );
  }

  async releaseOAuthTransaction(id: string): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE "auth"."oauth_transactions"
       SET "processing_at" = NULL
       WHERE "id" = $1 AND "consumed_at" IS NULL
       RETURNING "id"`,
      [id],
    );
    return queryRows(result).length;
  }

  async upsertUser(identity: GoogleIdentity): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      let user = await manager.findOne(User, { where: { googleSub: identity.googleSub } });
      const normalizedEmail = identity.email.trim().toLowerCase();
      if (!user) {
        user = manager.create(User, {
          emailVerified: true,
          googleSub: identity.googleSub,
          normalizedEmail,
          role: AccountRole.USER,
          status: AccountStatus.ACTIVE,
        });
        user = await manager.save(user);
        await manager.insert(UserProfile, { userId: user.id });
      } else if (user.status === AccountStatus.ACTIVE && user.normalizedEmail !== normalizedEmail) {
        user.normalizedEmail = normalizedEmail;
        user = await manager.save(user);
      }
      return user;
    });
  }

  async createSessionPair(userId: string): Promise<AuthSessionPair> {
    const accessToken = cryptoRandomToken();
    const refreshToken = cryptoRandomToken();
    const now = Date.now();
    const accessExpiresAt = new Date(now + 15 * 60_000);
    const refreshExpiresAt = new Date(now + 30 * 24 * 60 * 60_000);
    const familyId = cryptoRandomUuid();
    const repository = this.dataSource.getRepository(Session);
    await repository.insert([
      sessionRecord(userId, familyId, SessionTokenType.ACCESS, accessToken, accessExpiresAt),
      sessionRecord(userId, familyId, SessionTokenType.REFRESH, refreshToken, refreshExpiresAt),
    ]);
    return {
      accessExpiresAt: accessExpiresAt.toISOString(),
      accessToken,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      refreshToken,
    };
  }
}

function cryptoRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

function sessionRecord(userId: string, familyId: string, tokenType: SessionTokenType, token: string, expiresAt: Date): Partial<Session> {
  return {
    expiresAt,
    lastUsedAt: null,
    previousTokenHash: null,
    revokedAt: null,
    revokedReason: null,
    rotationCounter: 0,
    sessionFamilyId: familyId,
    tokenHash: hashOAuthValue(token),
    tokenType,
    userId,
  };
}
