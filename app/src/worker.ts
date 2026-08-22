import { NestFactory } from '@nestjs/core';

import { createApplicationLogger } from './common/logging/application-logger.factory';
import { runStartupMigrations } from './database/migrate';
import { WorkerModule } from './worker/worker.module';

export async function bootstrapWorker(): Promise<void> {
  await runStartupMigrations();
  const workerModule = process.env.WORKER_EXECUTION_MODE === 'relay-only'
    ? WorkerModule
    : (await import('./worker/legacy-worker.module')).LegacyWorkerModule;
  const app = await NestFactory.createApplicationContext(workerModule, {
    logger: createApplicationLogger({ environment: process.env.NODE_ENV }),
  });
  app.enableShutdownHooks();
}

if (require.main === module) {
  void bootstrapWorker().catch(() => {
    createApplicationLogger({ environment: process.env.NODE_ENV }).error(
      { event: 'worker.bootstrap.failed', runtime: 'worker' },
      undefined,
      'WorkerBootstrap',
    );
    process.exitCode = 1;
  });
}
