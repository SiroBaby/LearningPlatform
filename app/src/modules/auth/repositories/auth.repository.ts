import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';
import { randomBytes, randomUUID } from 'node:crypto';

import { BaseRepository } from '../../../database/base.repository';
import { DateTimeUtil } from '../../../common/datetime.util';
import { createApplicationLogger } from '../../../common/logging/application-logger.factory';
import type { AuthProfileUpdate, AuthSessionPair, AuthUser, GoogleIdentity } from '../contracts/google-auth.contracts';
import { OAuthTransaction } from '../entities/oauth-transaction.entity';
import { AuthOutboxEvent } from '../entities/auth-outbox-event.entity';
import { Session } from '../entities/session.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { User } from '../entities/user.entity';
import { AccountRole } from '../enums/account-role.enum';
import { AccountStatus } from '../enums/account-status.enum';
import { SessionTokenType } from '../enums/session-token-type.enum';
import { SuperAdminBootstrapMode } from '../enums/super-admin-bootstrap-mode.enum';
import { hashOAuthValue } from '../oauth-crypto';

export interface PendingSuperAdminRoleChangeRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly targetUserId: string;
  readonly desiredRole: 'ADMIN' | 'SUPER_ADMIN';
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly approvalCount: number;
}

export interface SuperAdminBootstrapStatus {
  readonly activeSuperAdminCount: number;
  readonly mode: SuperAdminBootstrapMode;
}

export interface ExternalApprovalConsumption {
  readonly action: 'GRANT_BREAK_GLASS_SUPER_ADMIN' | 'LOCKOUT_RECOVERY';
  readonly audience: string;
  readonly environment: string;
  readonly expiresAt: Date;
  readonly jtiHash: string;
}

const OAUTH_PROCESSING_LEASE_TIMEOUT_SECONDS = 60;
const ROLE_CHANGE_REQUEST_TTL_MS = 30 * 60 * 1_000;
const BREAK_GLASS_EXPIRY_CLEANUP_INTERVAL_MS = 60 * 1_000;
const SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE = 143;
const SUPER_ADMIN_ADVISORY_LOCK_KEY = 1;

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
  private readonly logger = createApplicationLogger({ context: AuthRepository.name });
  private expiryCleanupInFlight: Promise<void> | undefined;
  private nextExpiryCleanupAt = 0;

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
           AND ("processing_at" IS NULL OR "processing_at" < now() - ($3 * interval '1 second'))
           AND "consumed_at" IS NULL
           AND "failed_at" IS NULL
           AND "attempt_count" < "max_attempts"
         RETURNING "id", "state_hash", "nonce_hash", "pkce_verifier_ciphertext", "environment",
                   "max_attempts", "attempt_count", "expires_at", "processing_at",
                   "consumed_at", "failed_at", "created_at"`,
        [stateHash, environment, OAUTH_PROCESSING_LEASE_TIMEOUT_SECONDS],
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

  async markOAuthTransactionConsumed(id: string, attemptCount: number): Promise<number> {
    const result = await this.dataSource.getRepository(OAuthTransaction).update(
      { id, attemptCount, consumedAt: IsNull(), failedAt: IsNull(), processingAt: Not(IsNull()) },
      { consumedAt: new Date(), processingAt: null },
    );
    return result.affected ?? 0;
  }

  async releaseOAuthTransaction(id: string, attemptCount: number): Promise<number> {
    const result = await this.dataSource.query(
      `UPDATE "auth"."oauth_transactions"
       SET "processing_at" = NULL
       WHERE "id" = $1 AND "attempt_count" = $2 AND "consumed_at" IS NULL
       RETURNING "id"`,
      [id, attemptCount],
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
    await this.update({ id: userId, role: AccountRole.USER, status: AccountStatus.ACTIVE }, { role: AccountRole.ADMIN });
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
      const temporarySuperAdminExpired = user?.role === AccountRole.SUPER_ADMIN
        && user.superAdminExpiresAt !== null
        && user.superAdminExpiresAt <= now;
      if (!user || user.status !== AccountStatus.ACTIVE || current.expiresAt <= now || temporarySuperAdminExpired) {
        await manager.update(Session, { sessionFamilyId: current.sessionFamilyId, revokedAt: IsNull() }, {
          revokedAt: now,
          revokedReason: temporarySuperAdminExpired
            ? 'BREAK_GLASS_EXPIRED'
            : user?.status === AccountStatus.SUSPENDED ? 'ACCOUNT_SUSPENDED' : 'SESSION_INVALID',
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
    this.requestBreakGlassExpiryCleanup();
    const now = new Date();
    const session = await this.dataSource.getRepository(Session).findOne({ where: {
      tokenHash: hashOAuthValue(accessToken),
      tokenType: SessionTokenType.ACCESS,
      revokedAt: IsNull(),
    } });
    if (!session || session.expiresAt <= now) return null;
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: session.userId } });
    const temporarySuperAdminExpired = user?.role === AccountRole.SUPER_ADMIN
      && user.superAdminExpiresAt !== null
      && user.superAdminExpiresAt <= now;
    if (!user || user.status !== AccountStatus.ACTIVE || temporarySuperAdminExpired) return null;
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

  async bootstrapFirstSuperAdmin(userId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      // A transaction-scoped lock serializes the absence check across concurrent bootstraps.
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE, SUPER_ADMIN_ADVISORY_LOCK_KEY]);
      const rows = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users"
         SET "role" = 'SUPER_ADMIN', "super_admin_expires_at" = NULL,
             "super_admin_role_epoch" = "super_admin_role_epoch" + 1, "updated_at" = now()
         WHERE "id" = $1 AND "role" = 'ADMIN' AND "status" = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
             AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now()))
           AND NOT EXISTS (SELECT 1 FROM "auth"."super_admin_audit_events" WHERE "event_type" = 'BOOTSTRAP_COMPLETED')
         RETURNING "id"`,
        [userId],
      ));
      if (rows.length !== 1) return false;
      await manager.query(
        `UPDATE "auth"."sessions" SET "revoked_at" = now(), "revoked_reason" = 'ROLE_CHANGED'
         WHERE "user_id" = $1 AND "revoked_at" IS NULL`, [userId],
      );
      await manager.query(
        `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id")
         VALUES ('BOOTSTRAP_COMPLETED', $1)`, [userId],
      );
      return true;
    });
  }

  async hasActiveSuperAdmin(): Promise<boolean> {
    return (await this.getSuperAdminBootstrapStatus()).activeSuperAdminCount > 0;
  }

  async getSuperAdminBootstrapStatus(): Promise<SuperAdminBootstrapStatus> {
    // Status reads are an infrequent, admin-only path suitable for best-effort
    // expiry maintenance. Authentication itself must stay free of global work.
    this.requestBreakGlassExpiryCleanup();
    const row = queryRows<{
      readonly active_super_admin_count: number | string;
      readonly has_bootstrap_history: boolean;
      readonly has_quorum_history: boolean;
    }>(await this.dataSource.query(
       `SELECT count(*) FILTER (WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
                  AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now()))::int AS "active_super_admin_count",
              EXISTS (SELECT 1 FROM "auth"."super_admin_audit_events" WHERE "event_type" = 'BOOTSTRAP_COMPLETED') AS "has_bootstrap_history",
              EXISTS (SELECT 1 FROM "auth"."super_admin_audit_events" WHERE "event_type" = 'QUORUM_REACHED') AS "has_quorum_history"
       FROM "auth"."users"`,
    ))[0];
    const activeSuperAdminCount = Number(row?.active_super_admin_count ?? 0);
    if (!row) return { activeSuperAdminCount: 0, mode: SuperAdminBootstrapMode.UNAVAILABLE };
    if (activeSuperAdminCount >= 2) return { activeSuperAdminCount, mode: SuperAdminBootstrapMode.NORMAL };
    if (activeSuperAdminCount === 1) {
      return {
        activeSuperAdminCount,
        mode: row.has_quorum_history ? SuperAdminBootstrapMode.QUORUM_RECOVERY : SuperAdminBootstrapMode.SEED_SECOND,
      };
    }
    return {
      activeSuperAdminCount,
      mode: row.has_bootstrap_history || row.has_quorum_history
        ? SuperAdminBootstrapMode.LOCKOUT_RECOVERY
        : SuperAdminBootstrapMode.FIRST_BOOTSTRAP,
    };
  }

  async createSuperAdminRoleChangeRequest(input: {
    readonly desiredRole: 'ADMIN' | 'SUPER_ADMIN';
    readonly requesterId: string;
    readonly targetUserId: string;
  }): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      // Serialize quorum checks with approvals/demotions so a request cannot be
      // created from a stale view of the active SUPER_ADMIN set.
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE, SUPER_ADMIN_ADVISORY_LOCK_KEY]);
      const rows = queryRows<{ readonly id: string }>(await manager.query(
        `INSERT INTO "auth"."super_admin_role_change_requests"
           ("requester_id", "target_user_id", "desired_role", "expires_at")
         SELECT $1, $2, $3, now() + ($4 * interval '1 millisecond')
           WHERE $1::uuid <> $2::uuid
             AND EXISTS (SELECT 1 FROM "auth"."users" WHERE "id" = $1 AND "role" IN ('ADMIN', 'SUPER_ADMIN') AND "status" = 'ACTIVE')
             AND (SELECT count(*) FROM "auth"."users"
                  WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
                    AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())
                    AND "id" <> $1::uuid AND "id" <> $2::uuid) >= 2
             AND EXISTS (
               SELECT 1 FROM "auth"."users"
               WHERE "id" = $2 AND "status" = 'ACTIVE'
                 AND (($3::varchar = 'SUPER_ADMIN' AND "role" <> 'SUPER_ADMIN')
                   OR ("role" = 'SUPER_ADMIN' AND $3::varchar = 'ADMIN'))
             )
         RETURNING "id"`,
        [input.requesterId, input.targetUserId, input.desiredRole, ROLE_CHANGE_REQUEST_TTL_MS],
      ));
      return rows[0]?.id ?? '';
    });
  }

  async approveSuperAdminRoleChange(input: { readonly approverId: string; readonly requestId: string }): Promise<0 | 1 | 2> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE, SUPER_ADMIN_ADVISORY_LOCK_KEY]);
      const request = queryRows<{
        readonly desired_role: 'ADMIN' | 'SUPER_ADMIN';
        readonly expires_at: Date;
        readonly requester_id: string;
        readonly target_user_id: string;
      }>(await manager.query(
        `SELECT "desired_role", "expires_at", "requester_id", "target_user_id"
         FROM "auth"."super_admin_role_change_requests"
         WHERE "id" = $1 AND "completed_at" IS NULL FOR UPDATE`, [input.requestId],
      ))[0];
      if (!request || input.approverId === request.requester_id || input.approverId === request.target_user_id) return 0;
      if (request.expires_at <= new Date()) return 0;
      const approver = queryRows<{ readonly id: string }>(await manager.query(
        `SELECT "id" FROM "auth"."users"
         WHERE "id" = $1 AND "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
           AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())`, [input.approverId],
      ))[0];
      if (!approver) return 0;
      const insertedApproval = queryRows<{ readonly approver_id: string }>(await manager.query(
        `INSERT INTO "auth"."super_admin_role_change_approvals" ("request_id", "approver_id", "approver_role_epoch")
         SELECT $1, "id", "super_admin_role_epoch"
         FROM "auth"."users"
         WHERE "id" = $2 AND "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
           AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())
         ON CONFLICT ("request_id", "approver_id") DO UPDATE
           SET "approver_role_epoch" = EXCLUDED."approver_role_epoch", "created_at" = now()
           WHERE "super_admin_role_change_approvals"."approver_role_epoch" IS DISTINCT FROM EXCLUDED."approver_role_epoch"
         RETURNING "approver_id"`, [input.requestId, input.approverId],
      )).length === 1;
      if (!insertedApproval) return 0;

      // Lock every involved account in one stable order. This prevents two role-change
      // transactions from acquiring overlapping approver/target locks in opposite order.
      const approvalRows = queryRows<{ readonly approver_id: string }>(await manager.query(
        `SELECT "approver_id"
         FROM "auth"."super_admin_role_change_approvals"
         WHERE "request_id" = $1
         ORDER BY "approver_id"`, [input.requestId],
      ));
      const lockedUserIds = [...new Set([
        request.requester_id,
        request.target_user_id,
        ...approvalRows.map((approval) => approval.approver_id),
      ])].sort();
      await manager.query(
        `SELECT "id"
         FROM "auth"."users"
         WHERE "id" = ANY($1::uuid[])
         ORDER BY "id"
         FOR UPDATE`, [lockedUserIds],
      );
      const target = queryRows<{ readonly role: AccountRole; readonly status: AccountStatus }>(await manager.query(
        `SELECT "role", "status" FROM "auth"."users" WHERE "id" = $1`, [request.target_user_id],
      ))[0];
      const targetIsEligible = target?.status === AccountStatus.ACTIVE && (
        request.desired_role === 'SUPER_ADMIN'
          ? target.role !== AccountRole.SUPER_ADMIN
          : target.role === AccountRole.SUPER_ADMIN
      );
      if (!targetIsEligible) {
        await manager.query(
          `DELETE FROM "auth"."super_admin_role_change_approvals"
           WHERE "request_id" = $1 AND "approver_id" = $2`, [input.requestId, input.approverId],
        );
        return 0;
      }
      const approvals = queryRows<{ readonly approver_id: string }>(await manager.query(
        `SELECT "approval"."approver_id"
         FROM "auth"."super_admin_role_change_approvals" AS "approval"
         JOIN "auth"."users" AS "approver" ON "approver"."id" = "approval"."approver_id"
         WHERE "approval"."request_id" = $1
           AND "approval"."approver_id" <> $2
           AND "approval"."approver_id" <> $3
           AND "approver"."role" = 'SUPER_ADMIN' AND "approver"."status" = 'ACTIVE'
           AND ("approver"."super_admin_expires_at" IS NULL OR "approver"."super_admin_expires_at" > now())
           AND "approval"."approver_role_epoch" = "approver"."super_admin_role_epoch"
         ORDER BY "approval"."approver_id"`, [input.requestId, request.requester_id, request.target_user_id],
      ));
      if (approvals.length < 2) return 1;
      if (request.desired_role === 'ADMIN') {
        const superAdmins = queryRows<{ readonly count: string }>(await manager.query(
          `SELECT count(*)::text AS "count" FROM "auth"."users"
           WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
             AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())`,
        ));
        if (Number(superAdmins[0]?.count ?? 0) <= 1) return 0;
      }
      const changed = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users" SET "role" = $2, "super_admin_expires_at" = NULL,
                "super_admin_role_epoch" = "super_admin_role_epoch" + 1, "updated_at" = now()
         WHERE "id" = $1 RETURNING "id"`, [request.target_user_id, request.desired_role],
      ));
      if (changed.length !== 1) return 0;
      await manager.query(
        `UPDATE "auth"."sessions" SET "revoked_at" = now(), "revoked_reason" = 'ROLE_CHANGED'
         WHERE "user_id" = $1 AND "revoked_at" IS NULL`, [request.target_user_id],
      );
      await manager.query(
        `UPDATE "auth"."super_admin_role_change_requests" SET "completed_at" = now()
         WHERE "id" = $1`, [input.requestId],
      );
      await manager.query(
        `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id")
         VALUES ('ROLE_CHANGE_COMPLETED', $1)`, [request.target_user_id],
      );
      if (request.desired_role === 'SUPER_ADMIN') {
        await manager.query(
          `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id", "metadata")
           SELECT 'QUORUM_REACHED', $1, jsonb_build_object('requestId', $2::text)
           WHERE (SELECT count(*) FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
                    AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())) >= 2
             AND NOT EXISTS (SELECT 1 FROM "auth"."super_admin_audit_events" WHERE "event_type" = 'QUORUM_REACHED')`,
          [request.target_user_id, input.requestId],
        );
      }
      await manager.query(
        `INSERT INTO "auth"."outbox" ("aggregate_id", "event_type", "idempotency_key", "payload")
         VALUES ($1, 'SuperAdminRoleChangeCompleted', $2, $3::jsonb)
         ON CONFLICT ("idempotency_key") DO NOTHING`,
        [request.target_user_id, `${input.requestId}:ROLE_CHANGE_COMPLETED`, JSON.stringify({ desiredRole: request.desired_role, requestId: input.requestId, targetUserId: request.target_user_id })],
      );
      return 2;
    });
  }

  async listPendingSuperAdminRoleChangeRequests(input: {
    readonly requesterId?: string;
    readonly limit: number;
  }): Promise<PendingSuperAdminRoleChangeRequest[]> {
    const limit = Math.min(50, Math.max(1, Math.trunc(input.limit)));
    const parameters: unknown[] = input.requesterId ? [input.requesterId, limit] : [limit];
    const requesterFilter = input.requesterId ? 'AND "request"."requester_id" = $1' : '';
    const limitParameter = input.requesterId ? '$2' : '$1';
    const rows = queryRows<{
      readonly id: string;
      readonly requester_id: string;
      readonly target_user_id: string;
      readonly desired_role: 'ADMIN' | 'SUPER_ADMIN';
      readonly created_at: Date;
      readonly expires_at: Date;
      readonly approval_count: number | string;
    }>(await this.dataSource.query(
      `SELECT "request"."id",
              "request"."requester_id",
              "request"."target_user_id",
              "request"."desired_role",
              "request"."created_at",
              "request"."expires_at",
              count("approver"."id")::int AS "approval_count"
       FROM "auth"."super_admin_role_change_requests" AS "request"
       LEFT JOIN "auth"."super_admin_role_change_approvals" AS "approval"
         ON "approval"."request_id" = "request"."id"
       LEFT JOIN "auth"."users" AS "approver"
        ON "approver"."id" = "approval"."approver_id"
        AND "approver"."status" = 'ACTIVE'
        AND "approver"."role" = 'SUPER_ADMIN'
        AND ("approver"."super_admin_expires_at" IS NULL OR "approver"."super_admin_expires_at" > now())
        AND "approval"."approver_role_epoch" = "approver"."super_admin_role_epoch"
        AND "approver"."id" <> "request"."requester_id"
        AND "approver"."id" <> "request"."target_user_id"
       WHERE "request"."completed_at" IS NULL
         AND "request"."expires_at" > now()
         ${requesterFilter}
       GROUP BY "request"."id", "request"."requester_id", "request"."target_user_id",
                "request"."desired_role", "request"."created_at", "request"."expires_at"
       ORDER BY "request"."created_at" DESC, "request"."id" DESC
       LIMIT ${limitParameter}`,
      parameters,
    ));
    return rows.map((row) => ({
      approvalCount: Number(row.approval_count),
      createdAt: row.created_at,
      desiredRole: row.desired_role,
      id: row.id,
      requesterId: row.requester_id,
      targetUserId: row.target_user_id,
      expiresAt: row.expires_at,
    }));
  }

  async grantBreakGlassSecondSuperAdmin(input: {
    readonly approval: ExternalApprovalConsumption;
    readonly targetUserId: string;
  }): Promise<boolean> {
    if (input.approval.action !== 'GRANT_BREAK_GLASS_SUPER_ADMIN') return false;
    const expiresAt = input.approval.expiresAt;
    const granted = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE, SUPER_ADMIN_ADVISORY_LOCK_KEY]);
      const alreadyConsumed = queryRows<{ readonly jti_hash: string }>(await manager.query(
        `SELECT "jti_hash"
         FROM "auth"."super_admin_external_approval_consumptions"
         WHERE "jti_hash" = $1
         FOR UPDATE`, [input.approval.jtiHash],
      ));
      if (alreadyConsumed.length !== 0) return false;
      const rows = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users"
         SET "role" = 'SUPER_ADMIN', "super_admin_expires_at" = $2,
             "super_admin_role_epoch" = "super_admin_role_epoch" + 1, "updated_at" = now()
         WHERE "id" = $1 AND "role" = 'ADMIN' AND "status" = 'ACTIVE'
           AND $2 > now() AND $2 <= now() + interval '24 hours'
           AND (SELECT count(*) FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
                  AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())) = 1
         RETURNING "id"`, [input.targetUserId, expiresAt],
      ));
      if (rows.length !== 1) return false;
      await manager.query(
        `INSERT INTO "auth"."super_admin_external_approval_consumptions"
          ("jti_hash", "action", "environment", "audience", "target_user_id", "expires_at")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.approval.jtiHash, input.approval.action, input.approval.environment, input.approval.audience, input.targetUserId, expiresAt],
      );
      await manager.query(
        `UPDATE "auth"."sessions" SET "revoked_at" = now(), "revoked_reason" = 'ROLE_CHANGED'
         WHERE "user_id" = $1 AND "revoked_at" IS NULL`, [input.targetUserId],
      );
      await manager.query(
        `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id", "expires_at", "metadata")
         VALUES ('BREAK_GLASS_GRANTED', $1, $2, jsonb_build_object('approvalJtiHash', $3::text, 'audience', $4::text))`,
        [input.targetUserId, expiresAt, input.approval.jtiHash, input.approval.audience],
      );
      await manager.query(
        `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id", "metadata")
         SELECT 'QUORUM_REACHED', $1, jsonb_build_object('approvalJtiHash', $2::text)
         WHERE (SELECT count(*) FROM "auth"."users" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'
                  AND ("super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now())) >= 2
           AND NOT EXISTS (
             SELECT 1 FROM "auth"."super_admin_audit_events"
             WHERE "event_type" = 'QUORUM_REACHED'
               AND "metadata" ->> 'approvalJtiHash' = $2::text
           )`,
        [input.targetUserId, input.approval.jtiHash],
      );
      await manager.query(
        `INSERT INTO "auth"."outbox" ("aggregate_id", "event_type", "idempotency_key", "payload")
         VALUES ($1, 'SuperAdminBreakGlassGranted', $2, $3::jsonb)
         ON CONFLICT ("idempotency_key") DO NOTHING`,
        [input.targetUserId, `${input.approval.jtiHash}:BREAK_GLASS_GRANTED`, JSON.stringify({ expiresAt: expiresAt.toISOString(), targetUserId: input.targetUserId })],
      );
      return true;
    });
    if (!granted) return false;
    this.logger.error({ event: 'auth.super_admin.break_glass_granted', runtime: 'api' });
    return true;
  }

  private requestBreakGlassExpiryCleanup(): void {
    const now = Date.now();
    if (this.expiryCleanupInFlight || now < this.nextExpiryCleanupAt) return;
    this.nextExpiryCleanupAt = now + BREAK_GLASS_EXPIRY_CLEANUP_INTERVAL_MS;
    this.expiryCleanupInFlight = this.revokeExpiredBreakGlassSuperAdmins()
      .catch(() => {
        this.logger.error({ event: 'auth.super_admin.break_glass_expiry_cleanup_failed', runtime: 'api' });
      })
      .finally(() => {
        this.expiryCleanupInFlight = undefined;
      });
  }

  async expireExpiredBreakGlassSuperAdmins(): Promise<void> {
    if (this.expiryCleanupInFlight) {
      await this.expiryCleanupInFlight;
      return;
    }
    this.expiryCleanupInFlight = this.revokeExpiredBreakGlassSuperAdmins()
      .finally(() => {
        this.expiryCleanupInFlight = undefined;
      });
    await this.expiryCleanupInFlight;
  }

  private async revokeExpiredBreakGlassSuperAdmins(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const lock = queryRows<{ readonly acquired: boolean }>(await manager.query(
        'SELECT pg_try_advisory_xact_lock($1, $2) AS "acquired"',
        [SUPER_ADMIN_ADVISORY_LOCK_NAMESPACE, SUPER_ADMIN_ADVISORY_LOCK_KEY],
      ))[0];
      if (lock?.acquired !== true) return;
      const expired = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users" SET "role" = 'ADMIN', "super_admin_expires_at" = NULL,
                "super_admin_role_epoch" = "super_admin_role_epoch" + 1, "updated_at" = now()
         WHERE "role" = 'SUPER_ADMIN' AND "super_admin_expires_at" IS NOT NULL
           AND "super_admin_expires_at" <= now() RETURNING "id"`,
      ));
      if (expired.length === 0) return;
      await manager.query(
        `UPDATE "auth"."sessions" SET "revoked_at" = now(), "revoked_reason" = 'BREAK_GLASS_EXPIRED'
         WHERE "user_id" = ANY($1::uuid[]) AND "revoked_at" IS NULL`, [expired.map((entry) => entry.id)],
      );
      await manager.query(
        `DELETE FROM "auth"."super_admin_role_change_approvals" AS "approval"
         USING "auth"."super_admin_role_change_requests" AS "request"
         WHERE "approval"."request_id" = "request"."id"
           AND "request"."completed_at" IS NULL
           AND "approval"."approver_id" = ANY($1::uuid[])`, [expired.map((entry) => entry.id)],
      );
      await manager.query(
        `INSERT INTO "auth"."super_admin_audit_events" ("event_type", "target_user_id")
         SELECT 'BREAK_GLASS_EXPIRED', unnest($1::uuid[])`, [expired.map((entry) => entry.id)],
      );
      this.logger.error({ affected: expired.length, event: 'auth.super_admin.break_glass_expired', runtime: 'api' });
    });
  }

  async updateAccountStatus(userId: string, status: AccountStatus, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const changed = queryRows<{ readonly id: string }>(await manager.query(
        `UPDATE "auth"."users"
         SET "status" = $2,
             "super_admin_role_epoch" = "super_admin_role_epoch" + 1,
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
