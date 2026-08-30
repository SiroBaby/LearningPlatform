import { Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';

import { BaseRepository } from '../../../database/base.repository';
import { DateTimeUtil } from '../../../common/datetime.util';
import type { AuthProfileUpdate, AuthSessionPair, AuthUser, GoogleIdentity } from '../contracts/google-auth.contracts';
import { OAuthTransaction } from '../entities/oauth-transaction.entity';
import { AuthOutboxEvent } from '../entities/auth-outbox-event.entity';
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

  async promoteUserIfAllowlisted(userId: string, googleSub: string, allowlist: readonly string[]): Promise<void> {
    if (!allowlist.includes(googleSub)) return;
    await this.update({ id: userId, role: AccountRole.USER }, { role: AccountRole.ADMIN });
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

  async rotateRefreshSession(refreshToken: string): Promise<AuthSessionPair | null> {
    const tokenHash = hashOAuthValue(refreshToken);
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Session, { where: { tokenHash, tokenType: SessionTokenType.REFRESH } });
      if (!current) return null;
      const now = new Date();
      if (current.revokedAt) {
        await manager.update(Session, { sessionFamilyId: current.sessionFamilyId, revokedAt: IsNull() }, {
          revokedAt: now,
          revokedReason: 'REUSE_DETECTED',
        });
        return null;
      }
      const user = await manager.findOne(User, { where: { id: current.userId } });
      if (!user || user.status !== AccountStatus.ACTIVE || current.expiresAt <= now) {
        await manager.update(Session, { sessionFamilyId: current.sessionFamilyId, revokedAt: IsNull() }, {
          revokedAt: now,
          revokedReason: user?.status === AccountStatus.SUSPENDED ? 'ACCOUNT_SUSPENDED' : 'SESSION_INVALID',
        });
        return null;
      }
      const revoked = await manager.update(Session, { id: current.id, revokedAt: IsNull() }, {
        lastUsedAt: now,
        revokedAt: now,
        revokedReason: 'ROTATED',
      });
      if (revoked.affected !== 1) return null;
      const accessToken = cryptoRandomToken();
      const nextRefreshToken = cryptoRandomToken();
      const accessExpiresAt = new Date(now.getTime() + 15 * 60_000);
      const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
      await manager.insert(Session, [
        sessionRecord(user.id, current.sessionFamilyId, SessionTokenType.ACCESS, accessToken, accessExpiresAt),
        {
          ...sessionRecord(user.id, current.sessionFamilyId, SessionTokenType.REFRESH, nextRefreshToken, refreshExpiresAt),
          previousTokenHash: current.tokenHash,
          rotationCounter: current.rotationCounter + 1,
        },
      ]);
      return {
        accessExpiresAt: accessExpiresAt.toISOString(),
        accessToken,
        refreshExpiresAt: refreshExpiresAt.toISOString(),
        refreshToken: nextRefreshToken,
      };
    });
  }

  async revokeSessionFamily(token: string, reason: string): Promise<void> {
    const tokenHash = hashOAuthValue(token);
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(Session, { where: { tokenHash } });
      if (!session) return;
      await manager.update(Session, { sessionFamilyId: session.sessionFamilyId, revokedAt: IsNull() }, {
        revokedAt: new Date(),
        revokedReason: reason,
      });
    });
  }

  async getUserByAccessToken(accessToken: string): Promise<AuthUser | null> {
    const session = await this.dataSource.getRepository(Session).findOne({ where: {
      tokenHash: hashOAuthValue(accessToken),
      tokenType: SessionTokenType.ACCESS,
      revokedAt: IsNull(),
    } });
    if (!session || session.expiresAt <= new Date()) return null;
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: session.userId } });
    if (!user || user.status !== AccountStatus.ACTIVE) return null;
    const profile = await this.dataSource.getRepository(UserProfile).findOne({ where: { userId: user.id } });
    await this.dataSource.getRepository(Session).update({ id: session.id, revokedAt: IsNull() }, { lastUsedAt: new Date() });
    return {
      displayName: profile?.displayName ?? null,
      email: user.normalizedEmail,
      id: user.id,
      learningGoal: profile?.learningGoal ?? null,
      onboardingCompletedAt: profile?.onboardingCompletedAt?.toISOString() ?? null,
      onboardingSkippedAt: profile?.onboardingSkippedAt?.toISOString() ?? null,
      preferredLanguage: profile?.preferredLanguage ?? null,
      proficiencyLevel: profile?.proficiencyLevel ?? null,
      role: user.role,
      status: user.status,
    };
  }

  async updateProfile(userId: string, input: AuthProfileUpdate): Promise<void> {
    const values: Partial<UserProfile> = {};
    if (input.displayName !== undefined) values.displayName = input.displayName;
    if (input.learningGoal !== undefined) values.learningGoal = input.learningGoal;
    if (input.preferredLanguage !== undefined) values.preferredLanguage = input.preferredLanguage;
    if (input.proficiencyLevel !== undefined) values.proficiencyLevel = input.proficiencyLevel;
    if (input.onboardingAction === 'complete') {
      values.onboardingCompletedAt = DateTimeUtil.nowUtc();
      values.onboardingSkippedAt = null;
    } else if (input.onboardingAction === 'skip') {
      values.onboardingCompletedAt = null;
      values.onboardingSkippedAt = DateTimeUtil.nowUtc();
    } else if (input.onboardingAction === 'reset') {
      values.onboardingCompletedAt = null;
      values.onboardingSkippedAt = null;
    }
    if (Object.keys(values).length > 0) {
      await this.dataSource.getRepository(UserProfile).update({ userId }, values);
    }
  }

  async revokeUserSessions(userId: string, reason: string): Promise<void> {
    await this.dataSource.getRepository(Session).update({ userId, revokedAt: IsNull() }, {
      revokedAt: new Date(),
      revokedReason: reason,
    });
  }

  async updateAccountStatus(userId: string, status: AccountStatus, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const changed = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users"
         SET "status" = $2,
             "deleted_at" = CASE WHEN $2 = 'DELETED' THEN COALESCE("deleted_at", now()) ELSE NULL END,
             "updated_at" = now()
         WHERE "id" = $1
           AND "status" <> 'DELETED'
           AND "status" <> $2
         RETURNING "id"`,
        [userId, status],
      ));
      if (changed.length !== 1) return;

      await manager.update(Session, { userId, revokedAt: IsNull() }, {
        revokedAt: new Date(),
        revokedReason: reason,
      });
      await manager.insert(AuthOutboxEvent, {
        aggregateId: userId,
        eventType: 'AccountAccessRevoked',
        // Include a transition nonce so a later suspend cycle cannot collide
        // with an earlier outbox event for the same account and status.
        idempotencyKey: `${userId}:${status}:${randomUUID()}`,
        payload: { reason, userId },
        publishedAt: null,
      });
    });
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
