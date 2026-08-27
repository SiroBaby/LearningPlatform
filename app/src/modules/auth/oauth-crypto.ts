import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const AES_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PKCE_VERIFIER_BYTES = 32;

export function hashOAuthValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createPkcePair(): { readonly verifier: string; readonly challenge: string } {
  const verifier = randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return { verifier, challenge };
}

export function encryptPkceVerifier(verifier: string, encodedKey: string): Buffer {
  const key = decodeEncryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(verifier, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPkceVerifier(payload: Buffer, encodedKey: string): string {
  const key = decodeEncryptionKey(encodedKey);
  if (payload.length <= IV_BYTES + AUTH_TAG_BYTES) throw new Error('Invalid PKCE ciphertext');
  const decipher = createDecipheriv(AES_ALGORITHM, key, payload.subarray(0, IV_BYTES));
  decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES));
  return Buffer.concat([
    decipher.update(payload.subarray(IV_BYTES + AUTH_TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

function decodeEncryptionKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('OAuth encryption key must decode to 32 bytes');
  return key;
}
