import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { createApplicationLogger } from './common/logging/application-logger.factory';
import { createRequestLifecycleMiddleware } from './common/logging/request-lifecycle.middleware';
import { ApplicationConfigService } from './config/application-config.service';
import { createSwaggerBasicAuthMiddleware } from './common/swagger/swagger-basic-auth.middleware';
import { runStartupMigrations } from './database/migrate';
import { createInternalMtlsServer } from './internal-mtls-server';

export type ApiBootstrapStage =
  | 'startup-migrations'
  | 'nestjs-create'
  | 'application-config'
  | 'module-setup'
  | 'internal-mtls'
  | 'api-listen'
  | 'unknown';

const API_BOOTSTRAP_ERROR_CODE = 'API_BOOTSTRAP_FAILED';
const MAX_BOOTSTRAP_ERROR_MESSAGE_LENGTH = 240;

export class ApiBootstrapError extends Error {
  readonly code = API_BOOTSTRAP_ERROR_CODE;

  constructor(
    readonly stage: ApiBootstrapStage,
    readonly cause: unknown,
  ) {
    super(getThrownErrorMessage(cause));
    this.name = 'ApiBootstrapError';
  }
}

export interface ApiBootstrapFailureEvent {
  readonly causeCode?: string;
  readonly causeMessage?: string;
  readonly causeType?: string;
  readonly errorMessage: string;
  readonly errorType: string;
  readonly event: 'api.bootstrap.failed';
  readonly runtime: 'api';
  readonly stage: ApiBootstrapStage;
  readonly code: typeof API_BOOTSTRAP_ERROR_CODE;
}

export function formatApiBootstrapFailure(
  rejection: unknown,
): ApiBootstrapFailureEvent {
  const error = rejection instanceof ApiBootstrapError ? rejection : undefined;
  const cause = error?.cause;
  const errorValue = error ?? rejection;
  const causeType = getErrorType(cause);
  const causeCode = getErrorCode(cause);
  const causeMessage = getSafeErrorMessage(cause);
  return {
    code: error?.code ?? API_BOOTSTRAP_ERROR_CODE,
    ...(causeCode ? { causeCode } : {}),
    ...(causeMessage ? { causeMessage } : {}),
    ...(causeType ? { causeType } : {}),
    errorMessage: getSafeErrorMessage(errorValue),
    errorType: getErrorType(errorValue) ?? 'UnknownRejection',
    event: 'api.bootstrap.failed',
    runtime: 'api',
    stage: error?.stage ?? 'unknown',
  };
}

export function logApiBootstrapFailure(
  logger: Pick<Console, 'error'>,
  rejection: unknown,
): void {
  logger.error(formatApiBootstrapFailure(rejection));
}

async function runApiBootstrapStage<T>(
  stage: Exclude<ApiBootstrapStage, 'unknown'>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw cause instanceof ApiBootstrapError
      ? cause
      : new ApiBootstrapError(stage, cause);
  }
}

function getThrownErrorMessage(rejection: unknown): string {
  if (rejection instanceof Error) return rejection.message;
  if (typeof rejection === 'string') return rejection;
  return 'API bootstrap failed';
}

function getErrorType(value: unknown): string | undefined {
  if (value instanceof Error) {
    return /^[A-Za-z0-9._-]{1,64}$/u.test(value.name) ? value.name : 'Error';
  }
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') return 'UnknownRejection';
  return typeof value;
}

function getErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const code = Reflect.get(value, 'code');
    return typeof code === 'string' && /^[A-Za-z0-9._-]{1,64}$/u.test(code)
      ? code
      : undefined;
  } catch (cause) {
    return undefined;
  }
}

function getSafeErrorMessage(value: unknown): string {
  const message = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : 'Unknown bootstrap rejection';
  return sanitizeErrorMessage(message);
}

function sanitizeErrorMessage(message: string): string {
  let safeMessage = message.replace(/[\r\n\t ]+/gu, ' ').trim();
  safeMessage = safeMessage.replace(/\b(?:https?|wss?|ftp):\/\/[^\s)}\]]+/giu, '[redacted-url]');
  safeMessage = safeMessage.replace(/\b(?:bearer|basic)\s+[^\s,;]+/giu, (match) =>
    `${match.slice(0, match.indexOf(' '))} [redacted]`,
  );
  safeMessage = safeMessage.replace(
    /\b(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key)\s*[:=]\s*[^\s,;}]+/giu,
    '$1=[redacted]',
  );
  safeMessage = safeMessage.replace(/\b[A-Za-z0-9_-]+\?[^\s)}\]]+/gu, '[redacted-query]');
  safeMessage = safeMessage.replace(/\{[^{}]*\}/gu, '[redacted-payload]');
  return safeMessage.length > MAX_BOOTSTRAP_ERROR_MESSAGE_LENGTH
    ? `${safeMessage.slice(0, MAX_BOOTSTRAP_ERROR_MESSAGE_LENGTH - 3)}...`
    : safeMessage;
}

export async function bootstrapApi(): Promise<void> {
  await runApiBootstrapStage('startup-migrations', runStartupMigrations);
  const { app, logger } = await runApiBootstrapStage('nestjs-create', async () => {
    const logger = createApplicationLogger({ environment: process.env.NODE_ENV });
    const app = await NestFactory.create(AppModule, { logger });
    return { app, logger };
  });
  const application = await runApiBootstrapStage('application-config', async () => {
    const config = app.get(ApplicationConfigService);
    return config.application;
  });

  await runApiBootstrapStage('module-setup', async () => {
    app.enableShutdownHooks();
    app.use(createRequestLifecycleMiddleware());

    app.setGlobalPrefix('api/v1', { exclude: ['internal/v1/(.*)'] });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    const swaggerEnabled = application.swagger.enabled;
    if (swaggerEnabled) {
      const { password: swaggerPassword, username: swaggerUsername } = application.swagger;
      if (!swaggerUsername || !swaggerPassword) {
        throw new Error(
          'SWAGGER_USERNAME and SWAGGER_PASSWORD are required when Swagger is enabled',
        );
      }

      app.use(
        '/api/v1/docs',
        createSwaggerBasicAuthMiddleware(swaggerUsername, swaggerPassword),
      );

      const swaggerConfig = new DocumentBuilder()
        .setTitle('AI Learning Platform API')
        .setDescription('Phase 0 API: document upload and async processing.')
        .setVersion('0.1.0')
        .addApiKey(
          { in: 'header', name: 'X-User-Id', type: 'apiKey' },
          'ownerId',
        )
        .addBearerAuth(undefined, 'bearer')
        .addTag('Documents', 'Document upload and processing lifecycle.')
        .build();
      const document = SwaggerModule.createDocument(app, swaggerConfig);

      SwaggerModule.setup('docs', app, document, {
        customSiteTitle: 'AI Learning Platform API',
        raw: false,
        swaggerOptions: { persistAuthorization: true },
        useGlobalPrefix: true,
      });
    }
  });

  const internalMtls = await runApiBootstrapStage('internal-mtls', () =>
    createInternalMtlsServer(app, application.internalMtls),
  );
  if (internalMtls) {
    await runApiBootstrapStage('internal-mtls', async () => {
      await new Promise<void>((resolve) => internalMtls.server.listen(application.internalMtls.port, resolve));
      app.getHttpServer().once('close', () => void internalMtls.close());
    });
  }
  await runApiBootstrapStage('api-listen', async () => {
    await app.listen(application.port);
    logger.log({ event: 'api.started', port: application.port, runtime: 'api' }, 'ApiBootstrap');
  });
}

if (require.main === module) {
  void bootstrapApi().catch((rejection: unknown) => {
    logApiBootstrapFailure(
      createApplicationLogger({ environment: process.env.NODE_ENV }),
      rejection,
    );
    process.exitCode = 1;
  });
}
