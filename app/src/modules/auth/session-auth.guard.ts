import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthUser } from './contracts/google-auth.contracts';
import { AuthRepository } from './repositories/auth.repository';

export const AUTH_USER_REQUEST_KEY = 'authUser';

export type AuthenticatedRequest = Request & {
  [AUTH_USER_REQUEST_KEY]?: AuthUser;
};

export function extractBearerToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string') throw new UnauthorizedException('Invalid session');
  const match = /^Bearer\s+(\S+)$/u.exec(value);
  if (!match) throw new UnauthorizedException('Invalid session');
  return match[1];
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly repository: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const user = await this.repository.getUserByAccessToken(token);
    if (!user) throw new UnauthorizedException('Invalid session');

    request[AUTH_USER_REQUEST_KEY] = user;
    return true;
  }
}
