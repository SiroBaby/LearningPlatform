import { Injectable } from '@nestjs/common';

import type { LeaseAuthority, LeaseValidationRequest } from './contracts/lease-authority.contract';

@Injectable()
export class LeaseAuthorityService implements LeaseAuthority {
  async validate(_request: LeaseValidationRequest): Promise<boolean> {
    // The durable lease store is introduced by the Issue #20 migration. Deny until then.
    return false;
  }
}
