import { Injectable } from '@nestjs/common';
import { CodeChallengeMethod, OAuth2Client, type TokenPayload } from 'google-auth-library';

import { ApplicationConfigService } from '../../config/application-config.service';

export const GOOGLE_OAUTH_PROVIDER = Symbol('GOOGLE_OAUTH_PROVIDER');

export interface GoogleOAuthProvider {
  authorizationUrl(input: {
    readonly loginHint?: string;
    readonly nonce: string;
    readonly state: string;
    readonly codeChallenge: string;
  }): string;
  exchangeCode(code: string, codeVerifier: string): Promise<string>;
  verifyIdToken(idToken: string): Promise<TokenPayload | undefined>;
}

@Injectable()
export class GoogleOAuthClientProvider implements GoogleOAuthProvider {
  private readonly client: OAuth2Client;

  constructor(private readonly config: ApplicationConfigService) {
    const oauth = config.googleOAuth;
    this.client = new OAuth2Client(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
  }

  authorizationUrl(input: {
    readonly loginHint?: string;
    readonly nonce: string;
    readonly state: string;
    readonly codeChallenge: string;
  }): string {
    return this.client.generateAuthUrl({
      access_type: 'online',
      code_challenge: input.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      login_hint: input.loginHint,
      nonce: input.nonce,
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state: input.state,
    });
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const { tokens } = await this.client.getToken({ code, codeVerifier });
    if (!tokens.id_token) throw new Error('Missing Google ID token');
    return tokens.id_token;
  }

  async verifyIdToken(idToken: string): Promise<TokenPayload | undefined> {
    const ticket = await this.client.verifyIdToken({
      audience: this.config.googleOAuth.clientId,
      idToken,
    });
    return ticket.getPayload();
  }
}
