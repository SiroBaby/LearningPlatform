import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { ApplicationConfigModule } from '../../src/config/application-config.module';
import { InternalAuthGuard } from '../../src/common/internal-mtls.guard';
import { AuthOutboxEvent } from '../../src/modules/auth/entities/auth-outbox-event.entity';
import { OAuthTransaction } from '../../src/modules/auth/entities/oauth-transaction.entity';
import { Session } from '../../src/modules/auth/entities/session.entity';
import { UserProfile } from '../../src/modules/auth/entities/user-profile.entity';
import { User } from '../../src/modules/auth/entities/user.entity';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { GOOGLE_OAUTH_PROVIDER } from '../../src/modules/auth/google-oauth.provider';
import { startTestDb, type TestDb } from '../../src/test-support/test-db';
import { FakeGoogleOidcProvider } from '../support/fake-google-oidc-provider';

interface SessionPairResponse {
  readonly accessExpiresAt: string;
  readonly accessToken: string;
  readonly refreshExpiresAt: string;
  readonly refreshToken: string;
}

const AUTH_ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'IDENTITY_MODE',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'AUTH_OAUTH_ENCRYPTION_KEY',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

describe('Google OAuth HTTP flow with deterministic OIDC', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let db: TestDb;
  let provider: FakeGoogleOidcProvider;
  const originalEnvironment = new Map<string, string | undefined>(
    AUTH_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.IDENTITY_MODE = 'stub';
    process.env.GOOGLE_CLIENT_ID = 'fake-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
    process.env.AUTH_OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    db = await startTestDb();
    provider = new FakeGoogleOidcProvider({
      clientId: 'fake-google-client-id',
      redirectUri: 'http://localhost:3000/auth/google/callback',
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    const module = await Test.createTestingModule({
      imports: [
        ApplicationConfigModule,
        TypeOrmModule.forRoot({
          database: db.container.getDatabase(),
          entities: [AuthOutboxEvent, OAuthTransaction, Session, User, UserProfile],
          host: db.container.getHost(),
          password: db.container.getPassword(),
          port: db.container.getPort(),
          synchronize: false,
          type: 'postgres',
          username: db.container.getUsername(),
        }),
        AuthModule,
      ],
    })
      .overrideProvider(GOOGLE_OAUTH_PROVIDER)
      .useValue(provider)
      .overrideProvider(InternalAuthGuard)
      .useValue({ canActivate: (): boolean => true })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['internal/v1/(.*)'] });
    app.useGlobalPipes(new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }));
    await app.listen(0, '127.0.0.1');
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await db.client.query('TRUNCATE "auth"."sessions", "auth"."user_profiles", "auth"."users", "auth"."oauth_transactions" CASCADE');
  });

  afterAll(async () => {
    try {
      await app?.close();
      if (dataSource?.isInitialized) await dataSource.destroy();
      await db?.stop();
    } finally {
      for (const key of AUTH_ENVIRONMENT_KEYS) {
        const value = originalEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('runs start, authorization, exchange and me through the Nest HTTP boundary', async () => {
    const startResponse = await request('/internal/v1/auth/google/start', {
      body: JSON.stringify({ login_hint: 'learner@example.com' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(startResponse.status).toBe(201);
    const start = await startResponse.json() as { readonly authorizationUrl: string };
    const authorization = new URL(start.authorizationUrl);
    expect(authorization.searchParams.get('client_id')).toBe('fake-google-client-id');
    expect(authorization.searchParams.get('access_type')).toBe('online');
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/google/callback');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('login_hint')).toBe('learner@example.com');
    expect(authorization.searchParams.get('prompt')).toBe('select_account');

    const callback = provider.authorize(start.authorizationUrl, {
      email: 'learner@example.com',
      name: 'Learner',
      sub: 'google-sub-http-flow',
    });
    const callbackUrl = new URL(callback);
    const exchangeResponse = await request('/internal/v1/auth/google/exchange', {
      body: JSON.stringify({
        code: callbackUrl.searchParams.get('code'),
        state: callbackUrl.searchParams.get('state'),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(exchangeResponse.status).toBe(201);
    const session = await exchangeResponse.json() as SessionPairResponse;
    expect(session).toEqual({
      accessExpiresAt: expect.any(String),
      accessToken: expect.any(String),
      refreshExpiresAt: expect.any(String),
      refreshToken: expect.any(String),
    });

    const persisted = await db.client.query<{ readonly users: string; readonly profiles: string; readonly sessions: string; readonly consumed: string }>(`
      SELECT
        (SELECT count(*) FROM "auth"."users")::text AS users,
        (SELECT count(*) FROM "auth"."user_profiles")::text AS profiles,
        (SELECT count(*) FROM "auth"."sessions")::text AS sessions,
        (SELECT count(*) FROM "auth"."oauth_transactions" WHERE "consumed_at" IS NOT NULL)::text AS consumed
    `);
    expect(persisted.rows[0]).toEqual({ consumed: '1', profiles: '1', sessions: '2', users: '1' });

    const meResponse = await request('/internal/v1/auth/me', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      email: 'learner@example.com',
      role: 'USER',
      status: 'ACTIVE',
    });
  });

  it('rejects state reuse and unverified identities with generic errors', async () => {
    const startResponse = await request('/internal/v1/auth/google/start', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const start = await startResponse.json() as { readonly authorizationUrl: string };
    const callback = new URL(provider.authorize(start.authorizationUrl));
    const exchange = {
      code: callback.searchParams.get('code'),
      state: callback.searchParams.get('state'),
    };

    const first = await request('/internal/v1/auth/google/exchange', {
      body: JSON.stringify(exchange),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json() as SessionPairResponse;

    const reused = await request('/internal/v1/auth/google/exchange', {
      body: JSON.stringify(exchange),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(reused.status).toBe(401);
    expect(await reused.json()).toMatchObject({ message: 'OAuth login failed', statusCode: 401 });

    const unverifiedStartResponse = await request('/internal/v1/auth/google/start', {
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const unverifiedStart = await unverifiedStartResponse.json() as { readonly authorizationUrl: string };
    const unverifiedCallback = new URL(provider.authorize(unverifiedStart.authorizationUrl, {
      email_verified: false,
      sub: 'google-sub-unverified',
    }));
    const unverified = await request('/internal/v1/auth/google/exchange', {
      body: JSON.stringify({
        code: unverifiedCallback.searchParams.get('code'),
        state: unverifiedCallback.searchParams.get('state'),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(unverified.status).toBe(401);
    const unverifiedBody = await unverified.text();
    expect(unverifiedBody).toContain('OAuth login failed');
    expect(unverifiedBody).not.toContain('google-sub-unverified');
    expect(unverifiedBody).not.toContain('fake-code');

    const counts = await db.client.query<{ readonly users: string; readonly sessions: string; readonly processing: string }>(`
      SELECT
        (SELECT count(*) FROM "auth"."users")::text AS users,
        (SELECT count(*) FROM "auth"."sessions")::text AS sessions,
        (SELECT count(*) FROM "auth"."oauth_transactions" WHERE "processing_at" IS NOT NULL)::text AS processing
    `);
    expect(counts.rows[0]).toEqual({ processing: '0', sessions: '2', users: '1' });
    expect(firstBody.accessToken).not.toBe('');
  });

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Test HTTP server is not listening');
    return fetch(`http://127.0.0.1:${address.port}${path}`, init);
  }
});
