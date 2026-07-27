import { NestFactory } from '@nestjs/core';

import { createApplicationLogger } from './common/logging/application-logger.factory';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: createApplicationLogger({ environment: process.env.NODE_ENV }),
  });
  app.enableShutdownHooks();
}

void bootstrap().catch(() => {
  createApplicationLogger({ environment: process.env.NODE_ENV }).error(
    { event: 'worker.bootstrap.failed', runtime: 'worker' },
    undefined,
    'WorkerBootstrap',
  );
});
