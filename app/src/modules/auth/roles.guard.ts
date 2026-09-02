import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AccountRole } from './enums/account-role.enum';
import { REQUIRED_ACCOUNT_ROLES } from './roles.decorator';
import type { AuthenticatedRequest } from './session-auth.guard';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<readonly AccountRole[]>(REQUIRED_ACCOUNT_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      throw new ForbiddenException('Insufficient account role');
    }
    return true;
  }
}
