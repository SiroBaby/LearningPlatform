import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import { InternalAuthGuard } from '../../common/internal-mtls.guard';
import { AdminOperationsController } from './admin-operations.controller';
import { SuperAdminBootstrapMode } from './enums/super-admin-bootstrap-mode.enum';
import { REQUIRED_ACCOUNT_ROLES } from './roles.decorator';

describe('AdminOperationsController boundary', () => {
  it('keeps admin routes under the global api/v1 prefix without duplicating v1', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminOperationsController)).toBe('admin');
  });

  it('allows ADMIN or SUPER_ADMIN requesters while approval remains role-gated', () => {
    expect(Reflect.getMetadata(REQUIRED_ACCOUNT_ROLES, AdminOperationsController.prototype.requestRoleChange))
      .toEqual(expect.arrayContaining(['ADMIN', 'SUPER_ADMIN']));
  });

  it('exposes the pending role-change list at the documented route', async () => {
    const operations = {
      listRoleChangeRequests: jest.fn(async (..._args: readonly unknown[]) => ({ items: [], nextCursor: null })),
    };
    const mapper = { mapArray: jest.fn(() => []) };
    const controller = new AdminOperationsController(operations as never, mapper as never);

    expect(Reflect.getMetadata(METHOD_METADATA, AdminOperationsController.prototype.listRoleChangeRequests)).toBe(0);
    expect(Reflect.getMetadata(PATH_METADATA, AdminOperationsController.prototype.listRoleChangeRequests))
      .toBe('super-admin/role-change-requests');
    await expect(controller.listRoleChangeRequests({} as never, { status: 'pending', limit: 50 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(operations.listRoleChangeRequests).toHaveBeenCalledWith({}, 'pending', 50);
    expect(mapper.mapArray).toHaveBeenCalledTimes(1);
  });

  it('exposes only the named bootstrap mode at the documented route', async () => {
    const operations = {
      readSuperAdminBootstrapStatus: jest.fn(async (..._args: readonly unknown[]) => ({
        activeSuperAdminCount: 2,
        available: false,
        mode: SuperAdminBootstrapMode.NORMAL,
      })),
    };
    const controller = new AdminOperationsController(operations as never, {} as never);

    expect(Reflect.getMetadata(METHOD_METADATA, AdminOperationsController.prototype.readSuperAdminBootstrapStatus)).toBe(0);
    expect(Reflect.getMetadata(PATH_METADATA, AdminOperationsController.prototype.readSuperAdminBootstrapStatus))
      .toBe('super-admin/bootstrap/status');
    await expect(controller.readSuperAdminBootstrapStatus({} as never)).resolves.toEqual({ mode: SuperAdminBootstrapMode.NORMAL });
    expect(operations.readSuperAdminBootstrapStatus).toHaveBeenCalledWith({});
  });

  it('applies the BFF InternalAuthGuard to every admin operation route', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminOperationsController) as readonly unknown[];

    expect(guards).toContain(InternalAuthGuard);
  });

  it('exposes break-glass only as a protected ADMIN operation', () => {
    expect(Reflect.getMetadata(METHOD_METADATA, AdminOperationsController.prototype.grantBreakGlass)).toBe(1);
    expect(Reflect.getMetadata(PATH_METADATA, AdminOperationsController.prototype.grantBreakGlass)).toBe('super-admin/break-glass');
    expect(Reflect.getMetadata(REQUIRED_ACCOUNT_ROLES, AdminOperationsController.prototype.grantBreakGlass)).toEqual(['ADMIN']);
  });

  it('rejects a direct request without a verified mTLS client certificate', () => {
    const guard = new InternalAuthGuard({
      application: {
        identityMode: 'mtls',
        internalMtls: { expectedWebBffSpiffeUri: 'spiffe://learning-platform/web-bff' },
      },
    } as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ socket: { authorizationError: 'UNAUTHORIZED', authorized: false, getPeerCertificate: () => ({}) } }) }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
