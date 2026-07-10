import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

import { AppModule } from './app.module';
import { ApplicationConfigService } from './config/application-config.service';
import { createSwaggerBasicAuthMiddleware } from './common/swagger/swagger-basic-auth.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ApplicationConfigService);

  // correlationId: tiền đề cho trace xuyên hệ thống (xem 06/08-docs)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  });

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
  Logger.log(
    `App listening on http://localhost:${application.port}/api/v1`,
    'Bootstrap',
  );
}

void bootstrap();
