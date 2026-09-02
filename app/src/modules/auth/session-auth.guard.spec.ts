import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';

import type { AuthUser } from './contracts/google-auth.contracts';
import { AccountRole } from './enums/account-role.enum';
import { SessionAuthGuard } from './session-auth.guard';

const user: AuthUser = {
  displayName: 'Learner',
  email: 'learner@example.com',
  id: '00000000-0000-0000-0000-000000000001',
  role: AccountRole.USER,
  status: 'ACTIVE',
};

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  it('attaches the active user resolved from a bearer access token', async () => {
    const repository = {
      getUserByAccessToken: jest.fn(async (_token: string) => user),
    };
    const request = { headers: { authorization: 'Bearer access-token' } };

    await expect(new SessionAuthGuard(repository as never).canActivate(context(request))).resolves.toBe(true);
    expect(repository.getUserByAccessToken).toHaveBeenCalledWith('access-token');
    expect(request).toHaveProperty('authUser', user);
  });

  it('rejects a missing or malformed bearer token with 401', async () => {
    const repository = { getUserByAccessToken: jest.fn() };
    const guard = new SessionAuthGuard(repository as never);

    await expect(guard.canActivate(context({ headers: { 'x-user-id': user.id } }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.getUserByAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an expired, revoked, suspended, or deleted session resolved as no user', async () => {
    const repository = {
      getUserByAccessToken: jest.fn(async (_token: string) => null),
    };
    const guard = new SessionAuthGuard(repository as never);

    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer invalid-token' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
