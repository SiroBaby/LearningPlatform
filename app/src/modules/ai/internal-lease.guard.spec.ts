import { describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';

import { InternalLeaseGuard } from './internal-lease.guard';

const goWorkerSpiffeUri = 'spiffe://learning-platform.local/ns/learning-platform-qa/sa/go-worker';

const contextFor = (authorized: boolean, subjectaltname?: string) => ({
  switchToHttp: () => ({
    getRequest: () => ({
      socket: {
        authorized,
        getPeerCertificate: () => ({ subjectaltname }),
      },
    }),
  }),
});

describe('InternalLeaseGuard', () => {
  const guard = new InternalLeaseGuard({
    application: { internalMtls: { expectedClientSpiffeUri: goWorkerSpiffeUri } },
  } as never);

  it('rejects missing, expired, and untrusted client certificates', () => {
    expect(() => guard.canActivate(contextFor(false) as never)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor(false, `URI:${goWorkerSpiffeUri}`) as never)).toThrow(UnauthorizedException);
  });

  it('rejects a verified certificate with another URI SAN', () => {
    expect(() => guard.canActivate(contextFor(true, 'URI:spiffe://learning-platform.local/ns/learning-platform-qa/sa/other') as never)).toThrow(
      'Client certificate identity is not authorized',
    );
  });

  it('accepts exactly the configured non-development Go worker URI SAN', () => {
    expect(guard.canActivate(contextFor(true, `DNS:go-worker, URI:${goWorkerSpiffeUri}`) as never)).toBe(true);
  });
});
