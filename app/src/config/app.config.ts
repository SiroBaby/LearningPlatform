import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    password: process.env.SWAGGER_PASSWORD,
    username: process.env.SWAGGER_USERNAME,
  },
}));
