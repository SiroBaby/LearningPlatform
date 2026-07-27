import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import type { CredentialCipher } from './contracts/credential-cipher.contract';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;

export class LocalCredentialCipher implements CredentialCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Credential encryption key must be 32 bytes');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  decrypt(value: string): string {
    const encrypted = Buffer.from(value, 'base64url');
    const iv = encrypted.subarray(0, IV_BYTES);
    const authTag = encrypted.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = encrypted.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
