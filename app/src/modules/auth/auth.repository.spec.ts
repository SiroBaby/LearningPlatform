import { describe, expect, it, jest } from '@jest/globals';

import { AuthRepository } from './repositories/auth.repository';
import { AccountRole } from './enums/account-role.enum';
import { AccountStatus } from './enums/account-status.enum';
import { Session } from './entities/session.entity';
import { UserProfile } from './entities/user-profile.entity';
import { hashOAuthValue } from './oauth-crypto';

const transactionRow = {
  id: 'tx-1',
  state_hash: 'state-hash',
  nonce_hash: 'nonce-hash',
  pkce_verifier_ciphertext: Buffer.from('ciphertext'),
  environment: 'test',
  max_attempts: 5,
  attempt_count: 1,
  expires_at: new Date(),
  processing_at: new Date(),
  consumed_at: null,
  failed_at: null,
  created_at: new Date(),
};

describe('AuthRepository OAuth reservation', () => {
  it('atomically reserves only an unexpired, unconsumed transaction', async () => {
    const manager = {
      query: jest.fn(async () => [transactionRow]),
    };
      const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({ id: 'tx-1' });
    const claimSql = (manager.query as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(claimSql).toContain('"expires_at" > now()');
    expect(claimSql).toContain('(\"processing_at\" IS NULL OR \"processing_at\" < now() - ($3 * interval \'1 second\'))');
    expect(claimSql).toContain('"consumed_at" IS NULL');
    expect(claimSql).toContain('"attempt_count" < "max_attempts"');
  });

  it('supports query runners that return rows inside a result object', async () => {
    const manager = {
      query: jest.fn(async () => ({ rows: [transactionRow] })),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({
      id: 'tx-1',
      stateHash: 'state-hash',
    });
  });

  it('supports query runners that return a rows and row-count tuple', async () => {
    const manager = {
      query: jest.fn(async () => [[transactionRow], 1]),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toMatchObject({ id: 'tx-1' });
  });

  it('marks retry exhaustion as failed when atomic reservation finds no eligible row', async () => {
    const manager = { query: jest.fn(async (_sql: string, _parameters?: readonly unknown[]) => []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.beginOAuthExchange('state-hash', 'test')).resolves.toBeNull();
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect((manager.query as unknown as jest.Mock).mock.calls[1][0] as string).toContain('"failed_at" = COALESCE');
  });

  it('allows only one of concurrent reservations to win', async () => {
    let reservation = true;
    const makeManager = () => ({
      query: jest.fn(async () => {
        if (!reservation) return [];
        reservation = false;
        return [transactionRow];
      }),
    });
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: ReturnType<typeof makeManager>) => unknown) => callback(makeManager())),
    };
    const repository = new AuthRepository(dataSource as never);

    const results = await Promise.all([
      repository.beginOAuthExchange('state-hash', 'test'),
      repository.beginOAuthExchange('state-hash', 'test'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('releases a failed reservation with an explicit null update', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      query: jest.fn(async () => [{ id: 'tx-1' }]),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.releaseOAuthTransaction('tx-1', 1);
    expect(dataSource.query as unknown as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('SET "processing_at" = NULL'), ['tx-1', 1]);
    expect(dataSource.query as unknown as jest.Mock).toHaveBeenCalledWith(expect.stringContaining('"attempt_count" = $2'), ['tx-1', 1]);
  });
});

describe('AuthRepository SUPER_ADMIN status', () => {
  it('queries only for an active SUPER_ADMIN and returns the database boolean', async () => {
    const dataSource = {
      query: jest.fn(async () => [{ active_super_admin_count: 1, has_bootstrap_history: true, has_quorum_history: false }]),
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: { query: jest.Mock }) => unknown) => callback({ query: jest.fn(async () => []) })),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.hasActiveSuperAdmin()).resolves.toBe(true);
    const [sql] = (dataSource.query as unknown as jest.Mock).mock.calls[0];
    expect(sql).toContain('"role" = \'SUPER_ADMIN\'');
    expect(sql).toContain('"status" = \'ACTIVE\'');
    expect(sql).toContain('"super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now()');
    expect(sql).toContain('active_super_admin_count');
  });
});

describe('AuthRepository access-token expiry', () => {
  it('rejects an expired temporary SUPER_ADMIN while expiry cleanup runs lazily', async () => {
    const sessionRepository = {
      findOne: jest.fn(async () => ({
        expiresAt: new Date(Date.now() + 60_000),
        id: 'session-1',
        revokedAt: null,
        userId: 'user-1',
      })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const userRepository = {
      findOne: jest.fn(async () => ({
        id: 'user-1',
        normalizedEmail: 'admin@example.com',
        role: AccountRole.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        superAdminExpiresAt: new Date(Date.now() - 1),
      })),
    };
    const manager = {
      query: jest.fn(async (sql: string, _parameters?: readonly unknown[]) => {
        if (sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: true }];
        if (sql.includes('UPDATE "auth"."users"')) return [{ id: 'user-1' }];
        return [];
      }),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      getRepository: jest.fn((entity: unknown) => entity === Session ? sessionRepository : userRepository),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.getUserByAccessToken('expired-break-glass-token')).resolves.toBeNull();
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    await repository.expireExpiredBreakGlassSuperAdmins();
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("SET \"role\" = 'ADMIN'"));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("revoked_reason\" = 'BREAK_GLASS_EXPIRED'"), [['user-1']]);
  });

  it('does not wait for expiry cleanup before resolving a normal access lookup', async () => {
    const sessionRepository = {
      findOne: jest.fn(async () => ({
        expiresAt: new Date(Date.now() + 60_000),
        id: 'session-2',
        revokedAt: null,
        userId: 'user-2',
      })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    const userRepository = {
      findOne: jest.fn(async () => ({
        id: 'user-2',
        normalizedEmail: 'learner@example.com',
        role: AccountRole.USER,
        status: AccountStatus.ACTIVE,
        superAdminExpiresAt: null,
      })),
    };
    const profileRepository = { findOne: jest.fn(async () => null) };
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Session) return sessionRepository;
        if (entity === UserProfile) return profileRepository;
        return userRepository;
      }),
      transaction: jest.fn(() => cleanup),
    };
    const repository = new AuthRepository(dataSource as never);

    const result = await Promise.race([
      repository.getUserByAccessToken('normal-access-token'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);
    expect(result).not.toBe('timed-out');
    expect(result).toMatchObject({ id: 'user-2', role: AccountRole.USER });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    releaseCleanup();
  });
});

describe('AuthRepository allowlisted admin promotion', () => {
  it('promotes only an active USER and never mutates an inactive account during login', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
    };
    const repository = new AuthRepository(dataSource as never);
    const update = jest.spyOn(repository, 'update').mockImplementation(async () => undefined as never);

    await repository.promoteUserIfAllowlisted('user-1', 'google-sub-1', ['google-sub-1']);

    expect(update).toHaveBeenCalledWith(
      { id: 'user-1', role: AccountRole.USER, status: AccountStatus.ACTIVE },
      { role: AccountRole.ADMIN },
    );
  });

  it('does not query persistence when the Google subject is not allowlisted', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
    };
    const repository = new AuthRepository(dataSource as never);
    const update = jest.spyOn(repository, 'update');

    await repository.promoteUserIfAllowlisted('user-1', 'google-sub-1', []);

    expect(update).not.toHaveBeenCalled();
  });
});

describe('AuthRepository account status', () => {
  it('commits a cancellation command with the status transition', async () => {
    const manager = {
      query: jest.fn(async (_sql: string, _parameters: readonly unknown[]) => [{ id: 'user-1' }]),
      update: jest.fn(async (_target: unknown, _criteria: unknown, _values: unknown) => undefined),
      insert: jest.fn(async (_target: unknown, _values: unknown) => undefined),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.updateAccountStatus('user-1', AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"status" <> \'DELETED\''), [
      'user-1',
      AccountStatus.SUSPENDED,
    ]);
    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateId: 'user-1',
      eventType: 'AccountAccessRevoked',
      idempotencyKey: expect.stringMatching(/^user-1:SUSPENDED:[0-9a-f-]{36}$/),
      payload: { reason: 'ACCOUNT_SUSPENDED', userId: 'user-1' },
    }));
  });

  it('uses a new idempotency key when an account enters suspension again', async () => {
    let currentStatus = AccountStatus.ACTIVE;
    const insertedKeys = new Set<string>();
    const manager = {
      query: jest.fn(async (_sql: string, parameters: readonly unknown[]) => {
        const nextStatus = parameters[1] as AccountStatus;
        if (currentStatus === AccountStatus.DELETED || currentStatus === nextStatus) return [];
        currentStatus = nextStatus;
        return [{ id: 'user-1' }];
      }),
      update: jest.fn(async (_target: unknown, _criteria: unknown, _values: unknown) => undefined),
      insert: jest.fn(async (_target: unknown, values: { readonly idempotencyKey: string }) => {
        if (insertedKeys.has(values.idempotencyKey)) throw new Error('duplicate idempotency key');
        insertedKeys.add(values.idempotencyKey);
      }),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.updateAccountStatus('user-1', AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');
    // Model an explicit reactivation before the next suspension cycle.
    currentStatus = AccountStatus.ACTIVE;
    await repository.updateAccountStatus('user-1', AccountStatus.SUSPENDED, 'ACCOUNT_SUSPENDED');

    expect(insertedKeys.size).toBe(2);
    expect([...insertedKeys][0]).not.toBe([...insertedKeys][1]);
  });

  it('does not emit a duplicate command when the status is already terminal or unchanged', async () => {
    const manager = {
      query: jest.fn(async (_sql: string, _parameters: readonly unknown[]) => []),
      update: jest.fn(async (_target: unknown, _criteria: unknown, _values: unknown) => undefined),
      insert: jest.fn(async (_target: unknown, _values: unknown) => undefined),
    };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.updateAccountStatus('user-1', AccountStatus.DELETED, 'ACCOUNT_DELETED');

    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.insert).not.toHaveBeenCalled();
  });
});

describe('AuthRepository SUPER_ADMIN controls', () => {
  it('lists only pending role changes in stable order and counts active eligible approvals', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      query: jest.fn(async () => [{
        approval_count: '1',
        created_at: new Date('2026-09-02T08:00:00.000Z'),
        desired_role: 'SUPER_ADMIN',
        expires_at: new Date('2026-09-02T08:30:00.000Z'),
        id: 'request-1',
        requester_id: 'requester-1',
        target_user_id: 'target-1',
      }]),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.listPendingSuperAdminRoleChangeRequests({ limit: 99 })).resolves.toEqual([{
      approvalCount: 1,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      desiredRole: 'SUPER_ADMIN',
      expiresAt: new Date('2026-09-02T08:30:00.000Z'),
      id: 'request-1',
      requesterId: 'requester-1',
      targetUserId: 'target-1',
    }]);
    const [sql, parameters] = (dataSource.query as unknown as jest.Mock).mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain('"request"."completed_at" IS NULL');
    expect(sql).toContain('count("approver"."id")::int');
    expect(sql).toContain('"request"."expires_at"');
    expect(sql).toContain('ORDER BY "request"."created_at" DESC, "request"."id" DESC');
    expect(sql).toContain('LIMIT $1');
    expect(parameters).toEqual([50]);
  });

  it('filters ADMIN visibility by requester id without interpolating the id', async () => {
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      query: jest.fn(async () => []),
    };
    const repository = new AuthRepository(dataSource as never);

    await repository.listPendingSuperAdminRoleChangeRequests({ requesterId: 'admin-1', limit: 10 });
    const [sql, parameters] = (dataSource.query as unknown as jest.Mock).mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain('"request"."requester_id" = $1');
    expect(sql).toContain('LIMIT $2');
    expect(parameters).toEqual(['admin-1', 10]);
  });

  it('serializes first bootstrap with a transaction-scoped advisory lock and revokes its active sessions', async () => {
    const manager = { query: jest.fn(async (sql: string, _parameters?: readonly unknown[]) => {
      if (sql.includes('UPDATE "auth"."users"')) return [{ id: 'user-1' }];
      return [];
    }) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.bootstrapFirstSuperAdmin('user-1')).resolves.toBe(true);
    expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1, $2)', [143, 1]);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS (SELECT 1 FROM "auth"."users" WHERE "role" = \'SUPER_ADMIN\' AND "status" = \'ACTIVE\''), ['user-1']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now()'), ['user-1']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"revoked_reason" = \'ROLE_CHANGED\''), ['user-1']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("'BOOTSTRAP_COMPLETED'"), ['user-1']);
  });

  it('refuses requester or target approval before writing an approval row', async () => {
    const manager = { query: jest.fn(async (sql: string) => sql.includes('FROM "auth"."super_admin_role_change_requests"')
      ? [{ desired_role: 'SUPER_ADMIN', requester_id: 'requester', target_user_id: 'target' }]
      : []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.approveSuperAdminRoleChange({ approverId: 'target', requestId: 'request-1' })).resolves.toBe(0);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('does not count a duplicate approval as a second distinct approver', async () => {
    const manager = { query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM "auth"."super_admin_role_change_requests"')) {
        return [{ desired_role: 'SUPER_ADMIN', requester_id: 'requester', target_user_id: 'target' }];
      }
      if (sql.includes('FROM "auth"."users"') && sql.includes('"id" = $1')) return [{ id: 'approver' }];
      if (sql.includes('INSERT INTO "auth"."super_admin_role_change_approvals"')) return [];
      return [];
    }) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.approveSuperAdminRoleChange({ approverId: 'approver', requestId: 'request-1' })).resolves.toBe(0);
    expect(manager.query).toHaveBeenCalledTimes(4);
  });

  it('refuses self-targeted role-change creation before the request can be persisted', async () => {
    const manager = { query: jest.fn(async (_sql: string, _parameters?: readonly unknown[]) => []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'ADMIN', requesterId: 'same-user', targetUserId: 'same-user',
    })).resolves.toBe('');
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('WHERE $1::uuid <> $2::uuid'), ['same-user', 'same-user', 'ADMIN', 1_800_000]);
  });

  it('requires two eligible approvers after excluding the requester and target', async () => {
    const manager = { query: jest.fn(async (_sql: string, _parameters?: readonly unknown[]) => []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.createSuperAdminRoleChangeRequest({
      desiredRole: 'SUPER_ADMIN', requesterId: 'requester', targetUserId: 'target',
    })).resolves.toBe('');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('"id" <> $1::uuid AND "id" <> $2::uuid'),
      ['requester', 'target', 'SUPER_ADMIN', 1_800_000],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('"super_admin_expires_at" IS NULL OR "super_admin_expires_at" > now()'),
      ['requester', 'target', 'SUPER_ADMIN', 1_800_000],
    );
  });

  it('bounds break-glass elevation to 24 hours, revokes sessions, and records an audit event', async () => {
    const manager = { query: jest.fn(async (sql: string, _parameters?: readonly unknown[]) => sql.includes('UPDATE "auth"."users"') ? [{ id: 'user-2' }] : []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.grantBreakGlassSecondSuperAdmin({
      targetUserId: 'user-2',
      approval: {
        action: 'GRANT_BREAK_GLASS_SUPER_ADMIN',
        audience: 'test-audience',
        environment: 'test',
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        jtiHash: hashOAuthValue('test-break-glass-jti'),
      },
    })).resolves.toBe(true);
    expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1, $2)', [143, 1]);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("interval '24 hours'"), expect.any(Array));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"role" = \'ADMIN\''), expect.any(Array));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"revoked_reason" = \'ROLE_CHANGED\''), ['user-2']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"super_admin_audit_events"'), expect.any(Array));
  });

  it('requires an active target for break-glass recovery', async () => {
    const manager = { query: jest.fn(async (_sql: string, _parameters?: readonly unknown[]) => []) };
    const dataSource = {
      createEntityManager: jest.fn(() => ({})),
      transaction: jest.fn(async (callback: (value: typeof manager) => unknown) => callback(manager)),
    };
    const repository = new AuthRepository(dataSource as never);

    await expect(repository.grantBreakGlassSecondSuperAdmin({
      targetUserId: 'suspended-user',
      approval: {
        action: 'GRANT_BREAK_GLASS_SUPER_ADMIN',
        audience: 'test-audience',
        environment: 'test',
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        jtiHash: hashOAuthValue('test-break-glass-suspended-jti'),
      },
    })).resolves.toBe(false);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('"status" = \'ACTIVE\''), expect.any(Array));
  });
});
