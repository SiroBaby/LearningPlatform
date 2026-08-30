import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import type { Request } from 'express';
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from '../modules/auth/session-auth.guard';

/**
 * Returns the user identity attached by SessionAuthGuard.
 * Resource controllers never trust a caller-supplied owner header.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest & Request>();
    const user = req[AUTH_USER_REQUEST_KEY];
    const ownerId = user?.id;
    if (!ownerId || !isUuid(ownerId)) {
      throw new UnauthorizedException('Invalid session');
    }
    return ownerId;
  },
);
