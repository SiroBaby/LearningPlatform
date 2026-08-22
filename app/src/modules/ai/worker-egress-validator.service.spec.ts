import { describe, expect, it } from '@jest/globals';

import { UnpinnedClientDnsEgressValidator } from './worker-egress-validator.service';

describe('UnpinnedClientDnsEgressValidator', () => {
  it('rejects a hostname when any resolved address is private', async () => {
    const validator = new UnpinnedClientDnsEgressValidator({
      lookup: async () => [{ address: '203.0.113.10' }, { address: '10.0.0.7' }],
    });

    await expect(validator.validateBeforeUnpinnedClientCreation('proxy.example.com')).rejects.toThrow('prohibited network');
  });

  it('rejects DNS answer changes before an unpinned client is created', async () => {
    let calls = 0;
    const validator = new UnpinnedClientDnsEgressValidator({
      lookup: async () => {
        calls += 1;
        return [{ address: calls === 1 ? '203.0.113.10' : '203.0.113.11' }];
      },
    });

    await expect(validator.validateBeforeUnpinnedClientCreation('proxy.example.com')).rejects.toThrow('unstable');
  });

  it('accepts a stable public answer set', async () => {
    const validator = new UnpinnedClientDnsEgressValidator({
      lookup: async () => [{ address: '203.0.113.10' }, { address: '2001:db8::10' }],
    });

    await expect(validator.validateBeforeUnpinnedClientCreation('proxy.example.com')).resolves.toBeUndefined();
  });
});
