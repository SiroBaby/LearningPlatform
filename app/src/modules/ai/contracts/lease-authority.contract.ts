export const LEASE_AUTHORITY_AUDIENCE = 'ai-internal' as const;
export const LEASE_AUTHORITY_SCOPE = 'lease.validate' as const;

export interface LeaseFence {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseId: string;
}

export interface LeaseValidationRequest extends LeaseFence {
  readonly audience: typeof LEASE_AUTHORITY_AUDIENCE;
  readonly scope: typeof LEASE_AUTHORITY_SCOPE;
}

export interface LeaseAuthority {
  validate(request: LeaseValidationRequest): Promise<boolean>;
}

export const LEASE_AUTHORITY = Symbol('LEASE_AUTHORITY');
