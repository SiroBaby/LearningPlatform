import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, jest } from '@jest/globals';

import { AdminOperationsService } from './admin-operations.service';
import { ApplicationConfigService } from '../../config/application-config.service';
import type { AuthUser } from './contracts/google-auth.contracts';
import { AccountRole } from './enums/account-role.enum';
import { AccountStatus } from './enums/account-status.enum';
import { SuperAdminBootstrapMode } from './enums/super-admin-bootstrap-mode.enum';

const superAdmin: AuthUser = { displayName: null, email: 'admin@example.com', id: '00000000-0000-0000-0000-000000000001', role: AccountRole.SUPER_ADMIN, status: 'ACTIVE' };

describe('AdminOperationsService', () => {
  it('rejects direct service access by a USER', async () => {
    const service = new AdminOperationsService({ readSnapshot: jest.fn() } as never, {} as never);
    await expect(service.readSnapshot({ ...superAdmin, role: AccountRole.USER })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose non-allowlisted job fields from the read-only snapshot', async () => {
    const snapshot = { failureClasses: [], health: 'ok' as const, jobSummary: [], readiness: 'ready' as const, resources: ['processingJobs', 'authSessions'] as const };
    const service = new AdminOperationsService({ readSnapshot: jest.fn(async () => snapshot) } as never, {} as never);
    await expect(service.readSnapshot(superAdmin)).resolves.toEqual(snapshot);
  });

  it('fails bootstrap when a first SUPER_ADMIN already exists or the actor is not an ADMIN', async () => {
    const repository = { bootstrapFirstSuperAdmin: jest.fn(async () => false) };
    const service = new AdminOperationsService({} as never, repository as never);
    await expect(service.bootstrapFirstSuperAdmin({ ...superAdmin, role: AccountRole.ADMIN })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.bootstrapFirstSuperAdmin(superAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports bootstrap unavailable when an active SUPER_ADMIN exists', async () => {
    const repository = { getSuperAdminBootstrapStatus: jest.fn(async () => ({ activeSuperAdminCount: 2, mode: SuperAdminBootstrapMode.NORMAL })) };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.readSuperAdminBootstrapStatus({ ...superAdmin, role: AccountRole.ADMIN }))
      .resolves.toEqual({ activeSuperAdminCount: 2, available: false, mode: SuperAdminBootstrapMode.NORMAL });
    expect(repository.getSuperAdminBootstrapStatus).toHaveBeenCalledTimes(1);
  });

  it('fails closed at the service boundary for an ineligible actor', async () => {
    const repository = { getSuperAdminBootstrapStatus: jest.fn(async () => ({ activeSuperAdminCount: 0, mode: SuperAdminBootstrapMode.FIRST_BOOTSTRAP })) };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.readSuperAdminBootstrapStatus({ ...superAdmin, role: AccountRole.USER }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getSuperAdminBootstrapStatus).not.toHaveBeenCalled();
  });

  it('rejects an inactive actor even when the role is otherwise eligible', async () => {
    const repository = { bootstrapFirstSuperAdmin: jest.fn(async () => true) };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.bootstrapFirstSuperAdmin({
      ...superAdmin,
      role: AccountRole.ADMIN,
      status: AccountStatus.SUSPENDED,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.bootstrapFirstSuperAdmin).not.toHaveBeenCalled();
  });

  it('accepts the first distinct approval without claiming that the role change is complete', async () => {
    const repository = { approveSuperAdminRoleChange: jest.fn(async () => 1 as const) };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.approveRoleChange(superAdmin, '00000000-0000-0000-0000-000000000010')).resolves.toEqual({ completed: false });
  });

  it('allows an active ADMIN to create a role-change request', async () => {
    const repository = {
      createSuperAdminRoleChangeRequest: jest.fn(async () => '00000000-0000-0000-0000-000000000010'),
    };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.requestRoleChange({
      ...superAdmin,
      role: AccountRole.ADMIN,
    }, '00000000-0000-0000-0000-000000000011', 'SUPER_ADMIN')).resolves.toEqual({
      requestId: '00000000-0000-0000-0000-000000000010',
    });
  });

  it('returns all pending requests to SUPER_ADMIN and marks only eligible approvers', async () => {
    const repository = {
      listPendingSuperAdminRoleChangeRequests: jest.fn(async (..._args: readonly unknown[]) => [{
        approvalCount: 1,
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
        desiredRole: 'SUPER_ADMIN' as const,
        expiresAt: new Date('2026-09-02T08:30:00.000Z'),
        id: '00000000-0000-0000-0000-000000000010',
        requesterId: '00000000-0000-0000-0000-000000000011',
        targetUserId: '00000000-0000-0000-0000-000000000012',
      }, {
        approvalCount: 0,
        createdAt: new Date('2026-09-02T07:00:00.000Z'),
        desiredRole: 'ADMIN' as const,
        expiresAt: new Date('2026-09-02T07:30:00.000Z'),
        id: '00000000-0000-0000-0000-000000000013',
        requesterId: superAdmin.id,
        targetUserId: '00000000-0000-0000-0000-000000000014',
      }]),
    };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.listRoleChangeRequests(superAdmin, 'pending', 50)).resolves.toMatchObject({
      nextCursor: null,
      items: [
        { approvalCount: 1, canApprove: true, expiresAt: new Date('2026-09-02T08:30:00.000Z'), requiredApprovals: 2 },
        { approvalCount: 0, canApprove: false, expiresAt: new Date('2026-09-02T07:30:00.000Z'), requiredApprovals: 2 },
      ],
    });
    expect(repository.listPendingSuperAdminRoleChangeRequests).toHaveBeenCalledWith({ requesterId: undefined, limit: 50 });
  });

  it('restricts ADMIN results to requests created by that ADMIN and never allows approval', async () => {
    const admin = { ...superAdmin, id: '00000000-0000-0000-0000-000000000020', role: AccountRole.ADMIN };
    const repository = {
      listPendingSuperAdminRoleChangeRequests: jest.fn(async (..._args: readonly unknown[]) => [{
        approvalCount: 0,
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
        desiredRole: 'SUPER_ADMIN' as const,
        expiresAt: new Date('2026-09-02T08:30:00.000Z'),
        id: '00000000-0000-0000-0000-000000000021',
        requesterId: admin.id,
        targetUserId: '00000000-0000-0000-0000-000000000022',
      }]),
    };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.listRoleChangeRequests(admin, 'pending', 50)).resolves.toMatchObject({
      items: [{ canApprove: false, requesterId: admin.id }],
    });
    expect(repository.listPendingSuperAdminRoleChangeRequests).toHaveBeenCalledWith({ requesterId: admin.id, limit: 50 });
  });

  it('rejects unsupported status before querying persistence', async () => {
    const repository = { listPendingSuperAdminRoleChangeRequests: jest.fn() };
    const service = new AdminOperationsService({} as never, repository as never);

    await expect(service.listRoleChangeRequests(superAdmin, 'completed' as never, 50)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.listPendingSuperAdminRoleChangeRequests).not.toHaveBeenCalled();
  });

  it('requires an independently signed external approval and the target ADMIN session for break-glass', async () => {
    const repository = { grantBreakGlassSecondSuperAdmin: jest.fn() };
    const config = new ApplicationConfigService(new ConfigService({ app: { env: 'test', port: 3000, swagger: { enabled: false } } }));
    const service = new AdminOperationsService({} as never, repository as never, config);

    await expect(service.grantBreakGlassSecondSuperAdmin({
      ...superAdmin,
      id: '00000000-0000-0000-0000-000000000030',
      role: AccountRole.ADMIN,
    }, 'not-a-jws')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.grantBreakGlassSecondSuperAdmin).not.toHaveBeenCalled();
  });
});
