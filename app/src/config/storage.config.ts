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
  // The API signs media requests with its own identity; workers use separate credentials.
  mediaApiAccessKey: process.env.OBJECT_STORAGE_API_MEDIA_ACCESS_KEY,
  mediaApiSecretKey: process.env.OBJECT_STORAGE_API_MEDIA_SECRET_KEY,
  mediaEnabled: process.env.OBJECT_STORAGE_MEDIA_ENABLED === 'true',
  mediaBucket: process.env.OBJECT_STORAGE_MEDIA_BUCKET,
  egressProxyUrl: process.env.OBJECT_STORAGE_EGRESS_PROXY_URL,
  presignExpiry: parseInt(process.env.OBJECT_STORAGE_PRESIGN_EXPIRY ?? '300', 10),
}));
