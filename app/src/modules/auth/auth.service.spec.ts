import { describe, expect, it, jest } from '@jest/globals';
import type { TokenPayload } from 'google-auth-library';

import type { ApplicationConfigService } from '../../config/application-config.service';
import type { AuthSessionPair, GoogleIdentity } from './contracts/google-auth.contracts';
import { AuthService, classifyProviderError } from './auth.service';
import type { GoogleOAuthProvider } from './google-oauth.provider';
import { encryptPkceVerifier, hashOAuthValue } from './oauth-crypto';

const config = {
  application: { environment: 'test' },
  googleOAuth: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    encryptionKey: Buffer.alloc(32, 7).toString('base64'),
    redirectUri: 'http://localhost:3000/auth/google/callback',
  },
} as unknown as ApplicationConfigService;

const session: AuthSessionPair = {
  accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  accessToken: 'access',
  refreshExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  refreshToken: 'refresh',
};

function provider(payload: TokenPayload | undefined): GoogleOAuthProvider {
  return {
    authorizationUrl: jest.fn(() => 'https://fake-oidc.test/authorize'),
    exchangeCode: jest.fn(async () => 'fake-id-token'),
    verifyIdToken: jest.fn(async () => payload),
  };
}

function claims(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    aud: 'client-id',
    email: 'owner@example.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    iss: 'https://accounts.google.com',
    nonce: 'nonce',
    sub: 'google-sub',
    ...overrides,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    beginOAuthExchange: jest.fn(async () => ({
      id: 'transaction-id',
      nonceHash: hashOAuthValue('nonce'),
      pkceVerifierCiphertext: encryptPkceVerifier('verifier', config.googleOAuth.encryptionKey),
    })),
    createOAuthTransaction: jest.fn(async () => undefined),
    createSessionPair: jest.fn(async () => session),
    markOAuthTransactionConsumed: jest.fn(async () => undefined),
    promoteUserIfAllowlisted: jest.fn(async () => undefined),
    releaseOAuthTransaction: jest.fn(async () => 1),
    rotateRefreshSession: jest.fn(async () => session),
    revokeSessionFamily: jest.fn(async () => undefined),
    updateProfile: jest.fn(async () => undefined),
    getUserByAccessToken: jest.fn(async () => ({ id: 'user-id', email: 'owner@example.com', displayName: null, role: 'USER', status: 'ACTIVE' })),
    upsertUser: jest.fn(async (_identity: GoogleIdentity) => ({ id: 'user-id' })),
    ...overrides,
  };
}

describe('AuthService', () => {
  it.each([
    ['invalid_grant', { response: { data: { error: 'invalid_grant' } } }],
    ['unauthorized_client', { code: 'unauthorized_client' }],
    ['invalid_client', { code: 'invalid_client' }],
    ['network', { code: 'ENOTFOUND' }],
    ['timeout', { code: 'ETIMEDOUT' }],
    ['invalid_grant', { response: { status: 400 } }],
    ['invalid_client', { response: { status: 401 } }],
    ['timeout', { name: 'TimeoutError' }],
    ['unknown', { code: 'provider_failure' }],
  ])('classifies provider error as %s without exposing details', (category, error) => {
    expect(classifyProviderError(error)).toBe(category);
  });

  it('creates a short-lived OAuth transaction and authorization URL through the provider abstraction', async () => {
    const repo = repository();
    const oidc = provider(undefined);
    const service = new AuthService(config, repo as never, oidc);

    await expect(service.start(' owner@example.com ')).resolves.toEqual({
      authorizationUrl: 'https://fake-oidc.test/authorize',
    });
    expect(repo.createOAuthTransaction as unknown as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'test',
      expiresAt: expect.any(Date),
      nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      pkceVerifierCiphertext: expect.any(Buffer),
      stateHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(oidc.authorizationUrl as unknown as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      loginHint: 'owner@example.com',
      nonce: expect.any(String),
      state: expect.any(String),
    }));
  });

  it('exchanges a valid fake OIDC response and creates a session pair', async () => {
    const repo = repository();
    const oidc = provider(claims());
    const service = new AuthService(config, repo as never, oidc);

    await expect(service.exchange('code', 'state')).resolves.toEqual(session);
    expect(oidc.exchangeCode as unknown as jest.Mock).toHaveBeenCalledWith('code', 'verifier');
    expect(repo.upsertUser as unknown as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({ googleSub: 'google-sub', email: 'owner@example.com' }));
    expect(repo.markOAuthTransactionConsumed as unknown as jest.Mock).toHaveBeenCalledWith('transaction-id');
    expect(repo.createSessionPair as unknown as jest.Mock).toHaveBeenCalledWith('user-id');
    expect(repo.promoteUserIfAllowlisted as unknown as jest.Mock).toHaveBeenCalledWith('user-id', 'google-sub', []);
    expect(repo.releaseOAuthTransaction as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it('refreshes and revokes sessions through the repository lifecycle', async () => {
    const repo = repository();
    const service = new AuthService(config, repo as never, provider(undefined));

    await expect(service.refresh('refresh-token')).resolves.toEqual(session);
    await expect(service.me('access-token')).resolves.toMatchObject({ id: 'user-id', status: 'ACTIVE' });
    await expect(service.logout('access-token')).resolves.toBeUndefined();
    expect(repo.rotateRefreshSession as unknown as jest.Mock).toHaveBeenCalledWith('refresh-token');
    expect(repo.getUserByAccessToken as unknown as jest.Mock).toHaveBeenCalledWith('access-token');
    expect(repo.revokeSessionFamily as unknown as jest.Mock).toHaveBeenCalledWith('access-token', 'LOGOUT');
  });

  it('returns a generic unauthorized error when refresh or me has no valid session', async () => {
    const repo = repository({
      rotateRefreshSession: jest.fn(async () => null),
      getUserByAccessToken: jest.fn(async () => null),
    });
    const service = new AuthService(config, repo as never, provider(undefined));

    await expect(service.refresh('expired')).rejects.toThrow('Invalid session');
    await expect(service.me('expired')).rejects.toThrow('Invalid session');
  });

  it('updates profile only through a valid access session', async () => {
    const repo = repository();
    const service = new AuthService(config, repo as never, provider(undefined));

    await expect(service.updateProfile('access-token', {
      displayName: 'Ngoc Phat',
      onboardingAction: 'complete',
      preferredLanguage: 'vi',
    })).resolves.toMatchObject({ id: 'user-id' });
    expect(repo.updateProfile as unknown as jest.Mock).toHaveBeenCalledWith('user-id', expect.objectContaining({ onboardingAction: 'complete' }));
  });

  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'other-client' }],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['unverified email', { email_verified: false }],
  ])('rejects fake OIDC response with invalid %s', async (_label, override) => {
    const repo = repository();
    const service = new AuthService(config, repo as never, provider(claims(override)));

    await expect(service.exchange('code', 'state')).rejects.toThrow('OAuth login failed');
    expect(repo.releaseOAuthTransaction as unknown as jest.Mock).toHaveBeenCalledWith('transaction-id');
    expect(repo.upsertUser as unknown as jest.Mock).not.toHaveBeenCalled();
    expect(repo.createSessionPair as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', null],
    ['reused', null],
    ['retry exhausted', null],
  ])('rejects %s or unavailable OAuth transaction before provider exchange', async (_label, transaction) => {
    const repo = repository({ beginOAuthExchange: jest.fn(async () => transaction) });
    const oidc = provider(claims());
    const service = new AuthService(config, repo as never, oidc);

    await expect(service.exchange('code', 'state')).rejects.toThrow('OAuth login failed');
    expect(oidc.exchangeCode as unknown as jest.Mock).not.toHaveBeenCalled();
    expect(repo.releaseOAuthTransaction as unknown as jest.Mock).not.toHaveBeenCalled();
  });
});
