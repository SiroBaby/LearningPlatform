import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { LEASE_AUTHORITY_AUDIENCE, LEASE_AUTHORITY_SCOPE } from '../contracts/lease-authority.contract';
import { ValidateLeaseRequestDto } from './validate-lease.request.dto';

const validRequest = {
  attempt: 1,
  audience: LEASE_AUTHORITY_AUDIENCE,
  jobId: '116b0f94-f7e2-44ae-a686-c1298f638797',
  leaseId: 'be997f29-8cb0-4a48-8fd6-11f176c3b6f0',
  scope: LEASE_AUTHORITY_SCOPE,
};

describe('ValidateLeaseRequestDto', () => {
  it.each([
    ['wrong audience', { audience: 'public-api' }],
    ['wrong scope', { scope: 'lease.write' }],
    ['stale attempt', { attempt: 0 }],
  ])('rejects %s', async (_name, override) => {
    const errors = await validate(plainToInstance(ValidateLeaseRequestDto, { ...validRequest, ...override }));

    expect(errors).not.toHaveLength(0);
  });
});
