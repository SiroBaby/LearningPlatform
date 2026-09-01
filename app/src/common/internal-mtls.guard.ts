import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { TLSSocket } from 'node:tls';

import { ApplicationConfigService } from '../config/application-config.service';

interface PeerCertificate {
  readonly subjectaltname?: string;
}

export function assertInternalMtlsPeer(request: Request, expectedSpiffeUri: string | undefined): true {
  const socket = request.socket as TLSSocket;
  if (!socket.authorized || socket.authorizationError) {
    throw new UnauthorizedException('Verified client certificate is required');
  }

  const certificate = socket.getPeerCertificate() as PeerCertificate;
  const subjectAlternativeNames = certificate.subjectaltname
    ?.split(',')
    .map((value) => value.trim());
  if (!expectedSpiffeUri || !subjectAlternativeNames?.includes(`URI:${expectedSpiffeUri}`)) {
    throw new UnauthorizedException('Client certificate identity is not authorized');
  }

  return true;
}

@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ApplicationConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.application.identityMode === 'stub') return true;

    return assertInternalMtlsPeer(
      context.switchToHttp().getRequest<Request>(),
      this.config.application.internalMtls.expectedWebBffSpiffeUri,
    );
  }
}
