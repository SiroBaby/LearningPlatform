import { describe, expect, it } from '@jest/globals';

import { uuidFromSha256 } from './deterministic-id';

describe('uuidFromSha256', () => {
  it('maps the first SHA-256 bytes directly into a UUID', () => {
    const sha256OfAbc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    expect(uuidFromSha256(sha256OfAbc)).toBe('ba7816bf-8f01-5fea-8141-40de5dae2223');
  });
});
