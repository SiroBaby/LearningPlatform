import { describe, expect, it } from '@jest/globals';

import { createPkcePair, decryptPkceVerifier, encryptPkceVerifier, hashOAuthValue } from './oauth-crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('OAuth crypto helpers', () => {
  it('creates a PKCE S256 pair that round-trips through authenticated encryption', () => {
    const pair = createPkcePair();

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(decryptPkceVerifier(encryptPkceVerifier(pair.verifier, KEY), KEY)).toBe(pair.verifier);
  });

  it('rejects tampered ciphertext and keeps hashes deterministic', () => {
    const encrypted = encryptPkceVerifier('verifier', KEY);
    encrypted[encrypted.length - 1] ^= 1;

    expect(() => decryptPkceVerifier(encrypted, KEY)).toThrow();
    expect(hashOAuthValue('state')).toBe(hashOAuthValue('state'));
    expect(hashOAuthValue('state')).not.toBe(hashOAuthValue('other'));
  });
});
