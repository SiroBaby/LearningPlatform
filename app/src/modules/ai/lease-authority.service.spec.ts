import { describe, expect, it } from '@jest/globals';

import { LEASE_AUTHORITY_AUDIENCE, LEASE_AUTHORITY_SCOPE } from './contracts/lease-authority.contract';
import { LeaseAuthorityService } from './lease-authority.service';

describe('LeaseAuthorityService', () => {
  it('denies stale fences until the durable AI lease store exists', async () => {
    await expect(new LeaseAuthorityService().validate({
      attempt: 1,
      audience: LEASE_AUTHORITY_AUDIENCE,
      jobId: '116b0f94-f7e2-44ae-a686-c1298f638797',
      leaseId: 'be997f29-8cb0-4a48-8fd6-11f176c3b6f0',
      scope: LEASE_AUTHORITY_SCOPE,
    })).resolves.toBe(false);
  });
});
