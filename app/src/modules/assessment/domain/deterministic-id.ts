import { createHash } from 'crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function uuidFromSha256(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Expected a SHA-256 hex digest');
  }
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(hash[16], 16) & 0b11];

  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
