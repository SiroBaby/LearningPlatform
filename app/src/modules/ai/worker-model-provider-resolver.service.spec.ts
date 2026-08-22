import { describe, expect, it, jest } from '@jest/globals';

import { WorkerModelProviderResolver } from './worker-model-provider-resolver.service';

describe('WorkerModelProviderResolver', () => {
  it('validates custom egress before decrypting a credential', async () => {
    const decrypt = jest.fn(() => 'secret');
    const resolver = new WorkerModelProviderResolver(
      {
        create: async () => 'unused',
        findActiveForOwner: async () => ({
          apiKeyCiphertext: 'ciphertext',
          baseUrl: 'https://proxy.example.com/v1',
          capabilityVersion: 'v1',
          id: 'config-id',
          model: 'model',
          ownerId: 'owner-id',
          structuredOutputMode: 'json-object',
          transport: 'responses',
        }),
        listForOwner: async () => [],
        revoke: async () => false,
      },
      { decrypt, encrypt: (plaintext: string) => plaintext },
      { validateBeforeUnpinnedClientCreation: async () => { throw new Error('blocked egress'); } },
    );

    await expect(resolver.resolve('owner-id', 'config-id')).rejects.toThrow('blocked egress');
    expect(decrypt).not.toHaveBeenCalled();
  });
});
