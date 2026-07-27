import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'learning',
  password: process.env.DB_PASSWORD ?? 'learning',
  name: process.env.DB_NAME ?? 'learning',
  ssl: {
    ca: process.env.DB_SSL_CA,
    mode: process.env.DB_SSL_MODE ?? 'disabled',
  },
}));
