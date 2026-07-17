import { randomBytes } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import { LocalCredentialCipher } from './local-credential-cipher';

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
    const encrypted = cipher.encrypt('secret-api-key');
    const corrupted = `${encrypted.slice(0, -1)}A`;

    expect(() => cipher.decrypt(corrupted)).toThrow();
  });
});
