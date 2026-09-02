import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';

import { AccountRole } from './enums/account-role.enum';
import { RolesGuard } from './roles.guard';

function context(role: AccountRole): ExecutionContext {
  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ authUser: { role } }) }),
  } as never;
}

describe('RolesGuard', () => {
  it('uses the role resolved by SessionAuthGuard instead of a client-provided role', () => {
    const reflector = { getAllAndOverride: () => [AccountRole.SUPER_ADMIN] };
    const guard = new RolesGuard(reflector as never);

    expect(() => guard.canActivate(context(AccountRole.USER))).toThrow(ForbiddenException);
  });

  it('allows the server-resolved SUPER_ADMIN role', () => {
    const reflector = { getAllAndOverride: () => [AccountRole.SUPER_ADMIN] };
    const guard = new RolesGuard(reflector as never);

    expect(guard.canActivate(context(AccountRole.SUPER_ADMIN))).toBe(true);
  });
});
