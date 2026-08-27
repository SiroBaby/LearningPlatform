import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { TokenPayload } from 'google-auth-library';
import { randomBytes } from 'node:crypto';

import { ApplicationConfigService } from '../../config/application-config.service';
import { createApplicationLogger } from '../../common/logging/application-logger.factory';
import type { AuthSessionPair, GoogleIdentity } from './contracts/google-auth.contracts';
import { AuthRepository } from './repositories/auth.repository';
import { createPkcePair, decryptPkceVerifier, encryptPkceVerifier, hashOAuthValue } from './oauth-crypto';
import { GOOGLE_OAUTH_PROVIDER, type GoogleOAuthProvider } from './google-oauth.provider';

type ProviderErrorCategory = 'invalid_grant' | 'unauthorized_client' | 'invalid_client' | 'network' | 'timeout' | 'unknown';

export function classifyProviderError(error: unknown): ProviderErrorCategory {
  if (!error || typeof error !== 'object') return 'unknown';
  const candidate = error as {
    readonly code?: unknown;
    readonly name?: unknown;
    readonly status?: unknown;
    readonly response?: { readonly status?: unknown; readonly data?: { readonly error?: unknown } };
  };
  const providerCode = typeof candidate.response?.data?.error === 'string'
    ? candidate.response.data.error
    : typeof candidate.code === 'string' ? candidate.code : undefined;
  if (providerCode === 'invalid_grant') return 'invalid_grant';
  if (providerCode === 'unauthorized_client') return 'unauthorized_client';
  if (providerCode === 'invalid_client') return 'invalid_client';
  const status = typeof candidate.response?.status === 'number' ? candidate.response.status : candidate.status;
  if (status === 401) return 'invalid_client';
  if (status === 400) return 'invalid_grant';
  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return 'timeout';
  if (providerCode === 'ETIMEDOUT' || providerCode === 'ESOCKETTIMEDOUT' || providerCode === 'ECONNRESET') return 'timeout';
  if (providerCode === 'ENOTFOUND' || providerCode === 'ECONNREFUSED' || providerCode === 'EAI_AGAIN') return 'network';
  return 'unknown';
}

@Injectable()
export class AuthService {
  private readonly logger = createApplicationLogger({ context: AuthService.name });

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly repository: AuthRepository,
    @Inject(GOOGLE_OAUTH_PROVIDER) private readonly googleOAuth: GoogleOAuthProvider,
  ) {}

  async start(loginHint?: string): Promise<{ readonly authorizationUrl: string }> {
    const oauth = this.config.googleOAuth;
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const pkce = createPkcePair();
    await this.repository.createOAuthTransaction({
      environment: this.config.application.environment,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      nonceHash: hashOAuthValue(nonce),
      pkceVerifierCiphertext: encryptPkceVerifier(pkce.verifier, oauth.encryptionKey),
      stateHash: hashOAuthValue(state),
    });
    return {
      authorizationUrl: this.googleOAuth.authorizationUrl({
        codeChallenge: pkce.challenge,
        loginHint: loginHint?.trim() || undefined,
        nonce,
        state,
      }),
    };
  }

  async exchange(code: string, state: string): Promise<AuthSessionPair> {
    const oauth = this.config.googleOAuth;
    let transaction: Awaited<ReturnType<AuthRepository['beginOAuthExchange']>> = null;
    let phase: 'reservation' | 'provider_exchange' | 'id_token_claims' | 'user_upsert' | 'transaction_consume' | 'session_create' = 'reservation';
    try {
      transaction = await this.repository.beginOAuthExchange(
        hashOAuthValue(state),
        this.config.application.environment,
      );
      if (!transaction) throw new UnauthorizedException('OAuth login failed');
      phase = 'provider_exchange';
      const verifier = decryptPkceVerifier(transaction.pkceVerifierCiphertext, oauth.encryptionKey);
      const idToken = await this.googleOAuth.exchangeCode(code, verifier);
      phase = 'id_token_claims';
      const payload = await this.googleOAuth.verifyIdToken(idToken);
      const identity = this.readIdentity(payload);
      if (hashOAuthValue(identity.nonce) !== transaction.nonceHash) throw new Error('OAuth nonce mismatch');
      phase = 'user_upsert';
      const user = await this.repository.upsertUser(identity);
      phase = 'transaction_consume';
      await this.repository.markOAuthTransactionConsumed(transaction.id);
      phase = 'session_create';
      const session = await this.repository.createSessionPair(user.id);
      return session;
    } catch (error: unknown) {
      this.logger.error({
        event: 'auth.google.exchange.failed',
        phase,
        providerCategory: phase === 'provider_exchange' ? classifyProviderError(error) : undefined,
        runtime: 'api',
      });
      try {
        if (transaction) {
          const released = await this.repository.releaseOAuthTransaction(transaction.id);
          if (released !== 1) {
            this.logger.error({
              affected: released,
              event: 'auth.google.exchange.release_failed',
              hasTransactionId: Boolean(transaction.id),
              phase: 'transaction_release',
              runtime: 'api',
            });
          }
        }
      } catch {
        this.logger.error({ event: 'auth.google.exchange.release_failed', phase: 'transaction_release', runtime: 'api' });
      }
      throw new UnauthorizedException('OAuth login failed');
    }
  }

  private readIdentity(payload: TokenPayload | undefined): GoogleIdentity {
    if (!payload || typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true || typeof payload.nonce !== 'string' || typeof payload.exp !== 'number') {
      throw new Error('Invalid Google identity claims');
    }
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw new Error('Invalid Google issuer');
    if (payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired Google identity claims');
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(this.config.googleOAuth.clientId)) throw new Error('Invalid Google audience');
    return {
      email: payload.email,
      emailVerified: true,
      googleSub: payload.sub,
      name: payload.name,
      nonce: payload.nonce,
    };
  }
}
