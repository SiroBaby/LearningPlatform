import { BadRequestException } from '@nestjs/common';

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.azure.internal']);

export function canonicalizeCustomModelUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new BadRequestException('Custom model URL must be an absolute HTTPS URL');
    }
    throw error;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new BadRequestException('Custom model URL must be HTTPS without credentials, query, or fragment');
  }
  if (BLOCKED_HOSTS.has(url.hostname.toLowerCase()) || isBlockedIpLiteral(url.hostname)) {
    throw new BadRequestException('Custom model URL host is not permitted');
  }
  return url.toString().replace(/\/$/u, '');
}

function isBlockedIpLiteral(hostname: string): boolean {
  const octets = hostname.split('.').map((value) => Number(value));
  if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const first = octets[0];
    const second = octets[1];
    return first === 0 || first === 10 || first === 127 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168;
  }
  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd');
}
