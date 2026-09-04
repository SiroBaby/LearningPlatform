import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // Host-only contract; OBJECT_STORAGE_PORT carries the TCP port.
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? 'localhost',
  port: parseInt(process.env.OBJECT_STORAGE_PORT ?? '9000', 10),
  region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
  useSSL: process.env.OBJECT_STORAGE_USE_SSL === 'true',
  accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? 'minioadmin',
  bucket: process.env.OBJECT_STORAGE_BUCKET ?? 'documents',
  presignExpiry: parseInt(process.env.OBJECT_STORAGE_PRESIGN_EXPIRY ?? '300', 10),
}));
