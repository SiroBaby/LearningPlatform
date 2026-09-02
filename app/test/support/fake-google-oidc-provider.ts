import { createHash, createPublicKey, createSign, createVerify, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto';

import type { TokenPayload } from 'google-auth-library';

import type { GoogleOAuthProvider } from '../../src/modules/auth/google-oauth.provider';

export const FAKE_GOOGLE_ISSUER = 'https://accounts.google.com';
const FAKE_GOOGLE_AUTH_ORIGIN = 'https://fake-google.test';
const FAKE_GOOGLE_AUTH_PATH = '/o/oauth2/v2/auth';
const EXPECTED_SCOPE = ['email', 'openid', 'profile'];
const EXPECTED_ACCESS_TYPE = 'online';
const EXPECTED_PROMPT = 'select_account';

interface AuthorizationRequest {
  readonly codeChallenge: string;
  readonly claims: Partial<TokenPayload>;
  readonly nonce: string;
  readonly expiresAt: number;
  used: boolean;
}

export interface FakeGoogleOidcOptions {
  readonly clientId?: string;
  readonly redirectUri?: string;
  readonly nowSeconds?: number;
}

export interface FakeGoogleJwk {
  readonly alg: 'RS256';
  readonly e: string;
  readonly kid: string;
  readonly kty: 'RSA';
  readonly n: string;
  readonly use: 'sig';
}

export interface FakeGoogleJwks {
  readonly keys: readonly FakeGoogleJwk[];
}

interface SigningKey {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

/**
 * In-process OIDC provider used by CI. It owns the authorization-code and
 * signed-ID-token lifecycle without contacting Google or requiring secrets.
 */
export class FakeGoogleOidcProvider implements GoogleOAuthProvider {
  readonly clientId: string;
  readonly redirectUri: string;
  private activeKeyId = 'fake-google-key-1';
  private readonly signingKeys = new Map<string, SigningKey>();
  private readonly authorizationCodes = new Map<string, AuthorizationRequest>();
  private now: number;
  private nextCode = 0;

  constructor(options: FakeGoogleOidcOptions = {}) {
    this.clientId = options.clientId ?? 'fake-google-client-id';
    this.redirectUri = options.redirectUri ?? 'http://localhost:3000/auth/google/callback';
    this.now = options.nowSeconds ?? 1_800_000_000;
    this.signingKeys.set(this.activeKeyId, createSigningKey());
  }

  get keyId(): string {
    return this.activeKeyId;
  }

  authorizationUrl(input: {
    readonly loginHint?: string;
    readonly nonce: string;
    readonly state: string;
    readonly codeChallenge: string;
  }): string {
    const url = new URL(`${FAKE_GOOGLE_AUTH_ORIGIN}${FAKE_GOOGLE_AUTH_PATH}`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('access_type', EXPECTED_ACCESS_TYPE);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', input.state);
    url.searchParams.set('prompt', EXPECTED_PROMPT);
    if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
    return url.toString();
  }

  /** Simulates the user approving the authorization request in the browser. */
  authorize(
    authorizationUrl: string,
    claims: Partial<TokenPayload> = {},
    options: { readonly expiresInSeconds?: number; readonly callbackState?: string } = {},
  ): string {
    const request = new URL(authorizationUrl);
    if (request.origin !== FAKE_GOOGLE_AUTH_ORIGIN || request.pathname !== FAKE_GOOGLE_AUTH_PATH) {
      throw new Error('Invalid fake authorization URL');
    }
    if (request.searchParams.get('client_id') !== this.clientId) {
      throw new Error('Invalid fake client_id');
    }
    if (request.searchParams.get('redirect_uri') !== this.redirectUri) {
      throw new Error('Invalid fake redirect_uri');
    }
    if (request.searchParams.get('response_type') !== 'code') {
      throw new Error('Invalid fake response_type');
    }
    if (request.searchParams.get('access_type') !== EXPECTED_ACCESS_TYPE) {
      throw new Error('Invalid fake access_type');
    }
    if (request.searchParams.get('prompt') !== EXPECTED_PROMPT) {
      throw new Error('Invalid fake prompt');
    }
    const requestedScope = (request.searchParams.get('scope') ?? '').split(/\s+/u).filter(Boolean).sort();
    if (requestedScope.length !== EXPECTED_SCOPE.length || requestedScope.some((scope, index) => scope !== EXPECTED_SCOPE[index])) {
      throw new Error('Invalid fake scope');
    }
    if (request.searchParams.get('code_challenge_method') !== 'S256') {
      throw new Error('Invalid fake code_challenge_method');
    }
    const state = request.searchParams.get('state');
    const nonce = request.searchParams.get('nonce');
    const codeChallenge = request.searchParams.get('code_challenge');
    if (!state || !nonce || !codeChallenge) throw new Error('Incomplete fake authorization request');

    const code = `fake-code-${String(++this.nextCode).padStart(4, '0')}`;
    this.authorizationCodes.set(code, {
      claims,
      codeChallenge,
      expiresAt: this.now + (options.expiresInSeconds ?? 300),
      nonce,
      used: false,
    });
    const callback = new URL(this.redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', options.callbackState ?? state);
    return callback.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const authorization = this.authorizationCodes.get(code);
    if (!authorization || authorization.used || authorization.expiresAt <= this.now) {
      throw new Error('invalid_grant');
    }
    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    if (challenge !== authorization.codeChallenge) throw new Error('invalid_grant');

    authorization.used = true;
    return this.mintIdToken({
      ...authorization.claims,
      nonce: authorization.nonce,
    });
  }

  async exchangeCallback(callbackUrl: string, expectedState: string, codeVerifier: string): Promise<string> {
    const callback = new URL(callbackUrl);
    const expectedRedirect = new URL(this.redirectUri);
    if (callback.origin !== expectedRedirect.origin || callback.pathname !== expectedRedirect.pathname) {
      throw new Error('redirect_uri_mismatch');
    }
    if (callback.searchParams.get('state') !== expectedState) throw new Error('state_mismatch');
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('invalid_grant');
    return this.exchangeCode(code, codeVerifier);
  }

  async verifyIdToken(idToken: string): Promise<TokenPayload | undefined> {
    const segments = idToken.split('.');
    if (segments.length !== 3) throw new Error('Invalid fake ID token');
    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Invalid fake ID token');
    let header: { readonly alg?: unknown; readonly kid?: unknown };
    let payload: TokenPayload;
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as typeof header;
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new Error('Invalid fake ID token');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid fake ID token header');

    const signingKey = this.resolvePublicKey(header.kid);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    if (!verifier.verify(signingKey, Buffer.from(encodedSignature, 'base64url'))) {
      throw new Error('Invalid fake ID token signature');
    }

    const audiences = typeof payload.aud === 'string' ? [payload.aud] : Array.isArray(payload.aud) ? payload.aud : [];
    if (payload.iss !== FAKE_GOOGLE_ISSUER) throw new Error('Invalid fake ID token issuer');
    if (!audiences.includes(this.clientId)) throw new Error('Invalid fake ID token audience');
    if (typeof payload.exp !== 'number' || payload.exp <= this.now) throw new Error('Expired fake ID token');
    return payload;
  }

  mintIdToken(
    overrides: Partial<TokenPayload> = {},
    headerOverrides: Partial<{ readonly alg: string; readonly kid: string; readonly typ: string }> = {},
  ): string {
    const payload: TokenPayload = {
      aud: this.clientId,
      email: 'learner@example.com',
      email_verified: true,
      exp: this.now + 300,
      iat: this.now,
      iss: FAKE_GOOGLE_ISSUER,
      nonce: 'fake-nonce',
      sub: 'fake-google-sub',
      ...overrides,
    };
    const header = { alg: 'RS256', kid: this.keyId, typ: 'JWT', ...headerOverrides };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const signer = createSign('RSA-SHA256');
    signer.update(`${encodedHeader}.${encodedPayload}`);
    signer.end();
    const signingKey = this.signingKeys.get(this.activeKeyId);
    if (!signingKey) throw new Error('Fake signing key is unavailable');
    const signature = signer.sign(signingKey.privateKey).toString('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  jwks(): FakeGoogleJwks {
    const keys = [...this.signingKeys.entries()].map(([kid, signingKey]) => {
      const jwk = signingKey.publicKey.export({ format: 'jwk' }) as { readonly e?: string; readonly n?: string };
      if (!jwk.e || !jwk.n) throw new Error('Fake RSA public key cannot be exported as JWK');
      return { alg: 'RS256', e: jwk.e, kid, kty: 'RSA', n: jwk.n, use: 'sig' } as const;
    });
    return { keys };
  }

  rotateSigningKey(keyId = `fake-google-key-${String(this.signingKeys.size + 1)}`): void {
    if (this.signingKeys.has(keyId)) throw new Error('Fake signing key already exists');
    this.signingKeys.set(keyId, createSigningKey());
    this.activeKeyId = keyId;
  }

  private resolvePublicKey(keyId: string): KeyObject {
    const jwk = this.jwks().keys.find((key) => key.kid === keyId);
    if (!jwk) throw new Error('Unknown fake ID token key');
    if (jwk.alg !== 'RS256' || jwk.kty !== 'RSA' || jwk.use !== 'sig') {
      throw new Error('Unsupported fake ID token key');
    }
    return createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
  }

  advance(seconds: number): void {
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Fake clock advance must be a positive integer');
    this.now += seconds;
  }
}

function createSigningKey(): SigningKey {
  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
