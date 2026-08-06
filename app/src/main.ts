import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { createApplicationLogger } from './common/logging/application-logger.factory';
import { createRequestLifecycleMiddleware } from './common/logging/request-lifecycle.middleware';
import { ApplicationConfigService } from './config/application-config.service';
import { createSwaggerBasicAuthMiddleware } from './common/swagger/swagger-basic-auth.middleware';
import { runStartupMigrations } from './database/migrate';

export async function bootstrapApi(): Promise<void> {
  await runStartupMigrations();
  const logger = createApplicationLogger({ environment: process.env.NODE_ENV });
  const app = await NestFactory.create(AppModule, { logger });
  app.enableShutdownHooks();
  const config = app.get(ApplicationConfigService);

  app.use(createRequestLifecycleMiddleware());

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const application = config.application;
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

  await app.listen(application.port);
  logger.log({ event: 'api.started', port: application.port, runtime: 'api' }, 'ApiBootstrap');
}

if (require.main === module) {
  void bootstrapApi().catch(() => {
    createApplicationLogger({ environment: process.env.NODE_ENV }).error(
      { event: 'api.bootstrap.failed', runtime: 'api' },
      undefined,
      'ApiBootstrap',
    );
    process.exitCode = 1;
  });
}
