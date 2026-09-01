import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  identityMode: process.env.IDENTITY_MODE ?? 'mtls',
  port: parseInt(process.env.PORT ?? '3000', 10),
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
    encryptionKey: process.env.AUTH_OAUTH_ENCRYPTION_KEY,
  },
  authAdminGoogleSubs: process.env.AUTH_ADMIN_GOOGLE_SUBS,
  internalMtls: {
    caPath: process.env.INTERNAL_MTLS_CA_PATH,
    certPath: process.env.INTERNAL_MTLS_CERT_PATH,
    expectedClientSpiffeUri: process.env.INTERNAL_MTLS_EXPECTED_CLIENT_SPIFFE_URI,
    expectedWebBffSpiffeUri: process.env.INTERNAL_MTLS_EXPECTED_WEB_BFF_SPIFFE_URI,
    keyPath: process.env.INTERNAL_MTLS_KEY_PATH,
    port: parseInt(process.env.INTERNAL_MTLS_PORT ?? '3443', 10),
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    password: process.env.SWAGGER_PASSWORD,
    username: process.env.SWAGGER_USERNAME,
  },
}));
