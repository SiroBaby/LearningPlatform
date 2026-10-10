import { randomBytes } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import { LocalCredentialCipher } from './local-credential-cipher';

const AUTH_TAG_OFFSET = 12;

describe('LocalCredentialCipher', () => {
  it('round-trips plaintext without embedding it in the ciphertext', () => {
    const cipher = new LocalCredentialCipher(randomBytes(32));
    const plaintext = 'secret-api-key';
    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it('rejects a modified ciphertext authentication tag', () => {
    const cipher = new LocalCredentialCipher(randomBytes(32));
    const encrypted = Buffer.from(cipher.encrypt('secret-api-key'), 'base64url');
    // Flip one bit of the first auth tag byte, after the 12-byte IV, so the
    // value always changes; editing the last base64url character may not.
    encrypted[AUTH_TAG_OFFSET] ^= 0x01;
    const corrupted = encrypted.toString('base64url');

    expect(() => cipher.decrypt(corrupted)).toThrow();
  });
});
