import { describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';

import { InternalAuthGuard, assertInternalMtlsPeer } from './internal-mtls.guard';

const webBffSpiffeUri = 'spiffe://learning-platform.local/ns/learning-platform-qa/sa/web-bff';

const contextFor = (authorized: boolean, subjectaltname?: string) => ({
  switchToHttp: () => ({
    getRequest: () => ({
      socket: {
        authorized,
        authorizationError: undefined,
        getPeerCertificate: () => ({ subjectaltname }),
      },
    }),
  }),
});

describe('InternalAuthGuard', () => {
  const guard = new InternalAuthGuard({
    application: { internalMtls: { expectedWebBffSpiffeUri: webBffSpiffeUri } },
  } as never);

  it('rejects missing or untrusted client certificates', () => {
    expect(() => guard.canActivate(contextFor(false) as never)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor(false, `URI:${webBffSpiffeUri}`) as never)).toThrow(UnauthorizedException);
  });

  it('rejects a certificate with another service identity', () => {
    expect(() => guard.canActivate(contextFor(true, 'URI:spiffe://learning-platform.local/ns/learning-platform-qa/sa/go-worker') as never)).toThrow(
      'Client certificate identity is not authorized',
    );
  });

  it('accepts the exact web-bff URI SAN among other SAN values', () => {
    expect(guard.canActivate(contextFor(true, `DNS:web-bff, URI:${webBffSpiffeUri}`) as never)).toBe(true);
  });

  it('rejects a missing configured identity', () => {
    expect(() => assertInternalMtlsPeer(contextFor(true, `URI:${webBffSpiffeUri}`).switchToHttp().getRequest() as never, undefined)).toThrow(
      'Client certificate identity is not authorized',
    );
  });

  it('allows the explicit local identity stub without a client certificate', () => {
    const localGuard = new InternalAuthGuard({
      application: { identityMode: 'stub' },
    } as never);

    expect(localGuard.canActivate(contextFor(false) as never)).toBe(true);
  });
});
