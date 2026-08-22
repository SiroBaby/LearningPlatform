import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { TLSSocket } from 'node:tls';

import { ApplicationConfigService } from '../../config/application-config.service';

interface PeerCertificate {
  readonly subjectaltname?: string;
}

@Injectable()
export class InternalLeaseGuard implements CanActivate {
  constructor(private readonly config: ApplicationConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const socket = request.socket as TLSSocket;
    if (!socket.authorized) throw new UnauthorizedException('Verified client certificate is required');

    const certificate = socket.getPeerCertificate() as PeerCertificate;
    const expectedSan = `URI:${this.config.application.internalMtls.expectedClientSpiffeUri}`;
    if (!certificate.subjectaltname?.split(', ').includes(expectedSan)) {
      throw new UnauthorizedException('Client certificate identity is not authorized');
    }
    return true;
  }
}
