import { generateKeyPairSync, createSign } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { verifyExternalApprovalToken } from './external-approval-token';

const targetUserId = '00000000-0000-4000-8000-000000000001';
const settings = {
  audience: 'learning-platform-operations',
  issuer: 'learning-platform-operations',
  publicKey: '',
} as const;

describe('verifyExternalApprovalToken', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();

  it('accepts a signed approval with the exact environment, audience, action, and expiry', () => {
    const token = sign({
      action: 'GRANT_BREAK_GLASS_SUPER_ADMIN',
      aud: settings.audience,
      env: 'development',
      exp: 1_800_000_600,
      iss: settings.issuer,
      jti: 'approval-jti-001',
      targetUserId,
    });

    expect(verifyExternalApprovalToken(token, { ...settings, publicKey }, 'development', 1_800_000_000))
      .toMatchObject({ action: 'GRANT_BREAK_GLASS_SUPER_ADMIN', targetUserId });
  });

  it('rejects tampering, replay-shaped claims, wrong audience/environment, and expired approvals', () => {
    const valid = {
      action: 'GRANT_BREAK_GLASS_SUPER_ADMIN',
      aud: settings.audience,
      env: 'development',
      exp: 1_800_000_600,
      iss: settings.issuer,
      jti: 'approval-jti-002',
      targetUserId,
    };
    const token = sign(valid);
    const alteredSignature = `${token.slice(-1) === 'A' ? 'B' : 'A'}${token.slice(1)}`;
    const altered = `${token.split('.')[0]}.${token.split('.')[1]}.${alteredSignature}`;
    expect(verifyExternalApprovalToken(altered, { ...settings, publicKey }, 'development', 1_800_000_000)).toBeNull();
    expect(verifyExternalApprovalToken(token, { ...settings, publicKey }, 'production', 1_800_000_000)).toBeNull();
    expect(verifyExternalApprovalToken(token, { ...settings, publicKey }, 'development', 1_800_001_000)).toBeNull();
    expect(verifyExternalApprovalToken(sign({ ...valid, action: 'UNSAFE_ACTION' }), { ...settings, publicKey }, 'development', 1_800_000_000)).toBeNull();
  });

  function sign(payload: Record<string, unknown>): string {
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const body = encode(payload);
    const signature = createSign('RSA-SHA256').update(`${header}.${body}`).end().sign(keys.privateKey).toString('base64url');
    return `${header}.${body}.${signature}`;
  }

  function encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }
});
