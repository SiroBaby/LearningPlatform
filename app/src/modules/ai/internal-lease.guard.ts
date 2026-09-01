import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApplicationConfigService } from '../../config/application-config.service';
import { assertInternalMtlsPeer } from '../../common/internal-mtls.guard';

@Injectable()
export class InternalLeaseGuard implements CanActivate {
  constructor(private readonly config: ApplicationConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    return assertInternalMtlsPeer(
      context.switchToHttp().getRequest<Request>(),
      this.config.application.internalMtls.expectedClientSpiffeUri,
    );
  }
}
