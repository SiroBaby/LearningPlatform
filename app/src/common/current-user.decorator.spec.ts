import { describe, expect, it } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { CurrentUser } from './current-user.decorator';
import { AUTH_USER_REQUEST_KEY } from '../modules/auth/session-auth.guard';
import { AccountRole } from '../modules/auth/enums/account-role.enum';

const authenticatedUser = {
  displayName: 'Learner',
  email: 'learner@example.com',
  id: '11111111-1111-4111-8111-111111111111',
  role: AccountRole.USER,
  status: 'ACTIVE',
} as const;

type CurrentUserMetadata = {
  factory: (data: unknown, context: ExecutionContext) => string;
};

class TestController {
  handler(): void {}
}

CurrentUser()(TestController.prototype, 'handler', 0);

function getCurrentUserFactory(): CurrentUserMetadata['factory'] {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'handler',
  ) as Record<string, CurrentUserMetadata>;
  const entry = Object.values(metadata)[0];
  if (!entry) throw new Error('CurrentUser metadata was not registered');
  return entry.factory;
}

function contextForRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('CurrentUser decorator', () => {
  it('resolves only the identity attached by the session guard', () => {
    const factory = getCurrentUserFactory();
    const request = { [AUTH_USER_REQUEST_KEY]: authenticatedUser };

    expect(factory(undefined, contextForRequest(request))).toBe(authenticatedUser.id);
  });

  it('rejects a request without an authenticated identity', () => {
    const factory = getCurrentUserFactory();

    expect(() => factory(undefined, contextForRequest({ headers: {} }))).toThrow(UnauthorizedException);
  });
});
