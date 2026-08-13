import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  internalMtls: {
    caPath: process.env.INTERNAL_MTLS_CA_PATH,
    certPath: process.env.INTERNAL_MTLS_CERT_PATH,
    expectedClientSpiffeUri: process.env.INTERNAL_MTLS_EXPECTED_CLIENT_SPIFFE_URI,
    keyPath: process.env.INTERNAL_MTLS_KEY_PATH,
    port: parseInt(process.env.INTERNAL_MTLS_PORT ?? '3443', 10),
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    password: process.env.SWAGGER_PASSWORD,
    username: process.env.SWAGGER_USERNAME,
  },
}));
