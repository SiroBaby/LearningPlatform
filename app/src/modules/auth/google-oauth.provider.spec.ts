import { describe, expect, it, jest } from '@jest/globals';
import { OAuth2Client } from 'google-auth-library';

import type { ApplicationConfigService } from '../../config/application-config.service';
import { GoogleOAuthClientProvider } from './google-oauth.provider';

const config = {
  googleOAuth: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:3000/auth/google/callback',
  },
} as unknown as ApplicationConfigService;

describe('GoogleOAuthClientProvider', () => {
  it('forwards the nonce to Google authorization URL generation', () => {
    const generateAuthUrl = jest
      .spyOn(OAuth2Client.prototype, 'generateAuthUrl')
      .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth');
    const provider = new GoogleOAuthClientProvider(config);

    expect(provider.authorizationUrl({
      codeChallenge: 'challenge',
      loginHint: 'owner@example.com',
      nonce: 'nonce-value',
      state: 'state-value',
    })).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
      nonce: 'nonce-value',
    }));

    generateAuthUrl.mockRestore();
  });
});
