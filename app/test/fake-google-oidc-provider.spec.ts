import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';

import { FakeGoogleOidcProvider } from './support/fake-google-oidc-provider';

describe('FakeGoogleOidcProvider', () => {
  it('simulates authorization redirect, PKCE exchange, signed ID token, and JWKS', async () => {
    const provider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });
    const verifier = 'verifier-value';
    const authorizationUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      loginHint: 'learner@example.com',
      nonce: 'nonce-1',
      state: 'state-1',
    });

    const authorization = new URL(authorizationUrl);
    expect(authorization.searchParams.get('login_hint')).toBe('learner@example.com');
    expect(authorization.searchParams.get('client_id')).toBe('fake-google-client-id');
    expect(authorization.searchParams.get('access_type')).toBe('online');
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('scope')).toBe('openid email profile');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('state')).toBe('state-1');
    expect(authorization.searchParams.get('prompt')).toBe('select_account');
    const callback = provider.authorize(authorizationUrl);
    expect(new URL(callback).searchParams.get('state')).toBe('state-1');

    const idToken = await provider.exchangeCallback(callback, 'state-1', verifier);
    const claims = await provider.verifyIdToken(idToken);
    expect(claims).toMatchObject({
      aud: 'fake-google-client-id',
      email_verified: true,
      iss: 'https://accounts.google.com',
      nonce: 'nonce-1',
      sub: 'fake-google-sub',
    });
    expect(provider.jwks()).toMatchObject({
      keys: [{ alg: 'RS256', kid: 'fake-google-key-1', kty: 'RSA', use: 'sig' }],
    });
  });

  it('rejects callback state mismatch without consuming the authorization code', async () => {
    const provider = new FakeGoogleOidcProvider();
    const verifier = 'verifier-value';
    const authorizationUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      nonce: 'nonce-1',
      state: 'state-1',
    });
    const callback = provider.authorize(authorizationUrl);

    await expect(provider.exchangeCallback(callback, 'different-state', verifier)).rejects.toThrow('state_mismatch');
    await expect(provider.exchangeCallback(callback, 'state-1', verifier)).resolves.toEqual(expect.any(String));
  });

  it('rejects authorization requests that do not match the registered client contract', () => {
    const provider = new FakeGoogleOidcProvider();
    const validUrl = new URL(provider.authorizationUrl({
      codeChallenge: 'challenge',
      nonce: 'nonce-1',
      state: 'state-1',
    }));
    const invalidParameters = [
      ['client_id', 'another-client', 'client_id'],
      ['redirect_uri', 'http://evil.example/callback', 'redirect_uri'],
      ['response_type', 'token', 'response_type'],
      ['access_type', 'offline', 'access_type'],
      ['prompt', 'none', 'prompt'],
      ['scope', 'openid email', 'scope'],
      ['code_challenge_method', 'plain', 'code_challenge_method'],
    ] as const;

    for (const [parameter, value, error] of invalidParameters) {
      const request = new URL(validUrl);
      request.searchParams.set(parameter, value);
      expect(() => provider.authorize(request.toString())).toThrow(error);
    }
  });

  it('rejects a callback sent to another redirect origin or path', async () => {
    const provider = new FakeGoogleOidcProvider();
    const authorizationUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update('verifier-value').digest('base64url'),
      nonce: 'nonce-1',
      state: 'state-1',
    });
    const callback = provider.authorize(authorizationUrl);
    await expect(provider.exchangeCallback(callback.replace('localhost:3000', 'evil.example'), 'state-1', 'verifier-value')).rejects.toThrow('redirect_uri_mismatch');
  });

  it('rejects reused, expired, and wrong-PKCE authorization codes', async () => {
    const provider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });
    const verifier = 'verifier-value';
    const authorizationUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      nonce: 'nonce-1',
      state: 'state-1',
    });
    const callback = provider.authorize(authorizationUrl);
    const idToken = await provider.exchangeCallback(callback, 'state-1', verifier);
    await expect(provider.exchangeCallback(callback, 'state-1', verifier)).rejects.toThrow('invalid_grant');
    expect(idToken).toEqual(expect.any(String));

    const expiredUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      nonce: 'nonce-2',
      state: 'state-2',
    });
    const expiredCallback = provider.authorize(expiredUrl, {}, { expiresInSeconds: 1 });
    provider.advance(2);
    await expect(provider.exchangeCallback(expiredCallback, 'state-2', verifier)).rejects.toThrow('invalid_grant');

    const wrongPkceUrl = provider.authorizationUrl({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      nonce: 'nonce-3',
      state: 'state-3',
    });
    const wrongPkceCallback = provider.authorize(wrongPkceUrl);
    await expect(provider.exchangeCallback(wrongPkceCallback, 'state-3', 'wrong-verifier')).rejects.toThrow('invalid_grant');
  });

  it('validates JWT signature, issuer, audience, and expiry while exposing app claims', async () => {
    const provider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });
    const valid = provider.mintIdToken({ nonce: 'nonce-1' });
    await expect(provider.verifyIdToken(valid)).resolves.toMatchObject({ nonce: 'nonce-1' });

    const tampered = `${valid.slice(0, valid.lastIndexOf('.') + 1)}${Buffer.from('bad-signature').toString('base64url')}`;
    await expect(provider.verifyIdToken(tampered)).rejects.toThrow('signature');
    await expect(provider.verifyIdToken(provider.mintIdToken({ iss: 'https://evil.example' }))).rejects.toThrow('issuer');
    await expect(provider.verifyIdToken(provider.mintIdToken({ aud: 'other-client' }))).rejects.toThrow('audience');
    await expect(provider.verifyIdToken(provider.mintIdToken({ exp: 1_799_999_999 }))).rejects.toThrow('Expired');
    await expect(provider.verifyIdToken(provider.mintIdToken({ email_verified: false }))).resolves.toMatchObject({ email_verified: false });
  });

  it('resolves signing keys from JWKS across key rotation', async () => {
    const provider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });
    const beforeRotation = provider.mintIdToken();

    provider.rotateSigningKey('fake-google-key-2');
    const afterRotation = provider.mintIdToken();

    expect(provider.jwks().keys.map((key) => key.kid)).toEqual([
      'fake-google-key-1',
      'fake-google-key-2',
    ]);
    await expect(provider.verifyIdToken(beforeRotation)).resolves.toBeDefined();
    await expect(provider.verifyIdToken(afterRotation)).resolves.toBeDefined();
  });

  it('rejects an unknown kid, a signature from another key, and an algorithm mismatch', async () => {
    const provider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });
    const otherProvider = new FakeGoogleOidcProvider({ nowSeconds: 1_800_000_000 });

    await expect(provider.verifyIdToken(provider.mintIdToken({}, { kid: 'unknown-key' }))).rejects.toThrow('Unknown fake ID token key');
    await expect(provider.verifyIdToken(otherProvider.mintIdToken())).rejects.toThrow('signature');
    await expect(provider.verifyIdToken(provider.mintIdToken({}, { alg: 'HS256' }))).rejects.toThrow('header');
  });

  it('rejects JWTs with a missing or extra segment', async () => {
    const provider = new FakeGoogleOidcProvider();
    const valid = provider.mintIdToken();
    const missingSegment = valid.slice(0, valid.lastIndexOf('.'));
    const extraSegment = `${valid}.unexpected`;

    await expect(provider.verifyIdToken(missingSegment)).rejects.toThrow('Invalid fake ID token');
    await expect(provider.verifyIdToken(extraSegment)).rejects.toThrow('Invalid fake ID token');
  });
});
