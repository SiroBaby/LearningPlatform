import { createVerify } from 'node:crypto';

import type { ExternalApprovalSettings } from '../../config/configuration.types';
import type { ExternalApprovalAction } from './contracts/external-approval.contracts';

const CLOCK_SKEW_SECONDS = 30;

export interface VerifiedExternalApproval {
  readonly action: ExternalApprovalAction;
  readonly audience: string;
  readonly environment: string;
  readonly expiresAt: Date;
  readonly jti: string;
  readonly issuer: string;
  readonly targetUserId: string;
}

interface ExternalApprovalPayload {
  readonly action?: unknown;
  readonly aud?: unknown;
  readonly env?: unknown;
  readonly exp?: unknown;
  readonly iss?: unknown;
  readonly jti?: unknown;
  readonly targetUserId?: unknown;
}

/**
 * Verify the small operational JWS contract locally. Only RS256 is accepted;
 * the private signing key never enters the API process.
 */
export function verifyExternalApprovalToken(
  token: string,
  settings: ExternalApprovalSettings,
  expectedEnvironment: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): VerifiedExternalApproval | null {
  if (!settings.publicKey?.trim() || !settings.issuer?.trim() || !settings.audience?.trim()) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;

  try {
    const header = readJson<{ readonly alg?: unknown }>(parts[0]);
    if (header.alg !== 'RS256') return null;
    const payload = readJson<ExternalApprovalPayload>(parts[1]);
    const expiresAtSeconds = payload.exp;
    if (
      typeof payload.action !== 'string' ||
      typeof payload.aud !== 'string' ||
      typeof payload.env !== 'string' ||
      typeof expiresAtSeconds !== 'number' ||
      !Number.isSafeInteger(expiresAtSeconds) ||
      typeof payload.iss !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.targetUserId !== 'string'
    ) return null;
    if (payload.aud !== settings.audience || payload.env !== expectedEnvironment || payload.iss !== settings.issuer) return null;
    if (expiresAtSeconds <= nowSeconds - CLOCK_SKEW_SECONDS) return null;
    if (expiresAtSeconds > nowSeconds + 24 * 60 * 60 + CLOCK_SKEW_SECONDS) return null;
    if (!/^[A-Za-z0-9._-]{8,255}$/u.test(payload.jti)) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(payload.targetUserId)) return null;
    if (!isExternalApprovalAction(payload.action)) return null;

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    if (!verifier.verify(settings.publicKey, decodeBase64Url(parts[2]))) return null;

    return {
      action: payload.action,
      audience: payload.aud,
      environment: payload.env,
      expiresAt: new Date(expiresAtSeconds * 1_000),
      issuer: payload.iss,
      jti: payload.jti,
      targetUserId: payload.targetUserId,
    };
  } catch {
    return null;
  }
}

function isExternalApprovalAction(value: string): value is ExternalApprovalAction {
  return value === 'GRANT_BREAK_GLASS_SUPER_ADMIN' || value === 'LOCKOUT_RECOVERY';
}

function readJson<T>(encoded: string): T {
  return JSON.parse(decodeBase64Url(encoded).toString('utf8')) as T;
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid compact JWS encoding');
  return Buffer.from(value, 'base64url');
}
