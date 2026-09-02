import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from '../modules/auth/session-auth.guard';
import type { AuthUser } from '../modules/auth/contracts/google-auth.contracts';

export const CurrentAuthUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request[AUTH_USER_REQUEST_KEY];
  },
);
