import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { createApplicationLogger } from './common/logging/application-logger.factory';
import { runStartupMigrations } from './database/migrate';
import { WorkerModule } from './worker/worker.module';

/** Worker modes allowed in production; legacy in-process processing is not. */
const PRODUCTION_WORKER_EXECUTION_MODES: ReadonlySet<string> = new Set(['document-purge', 'relay-only']);

export function assertProductionWorkerExecutionMode(
  environment = process.env.NODE_ENV,
  executionMode = process.env.WORKER_EXECUTION_MODE,
): void {
  if (environment === 'production' && !PRODUCTION_WORKER_EXECUTION_MODES.has(executionMode ?? '')) {
    throw new Error('WORKER_EXECUTION_MODE must be relay-only or document-purge in production');
  }
}

export async function bootstrapWorker(): Promise<void> {
  assertProductionWorkerExecutionMode();
  await runStartupMigrations();
  const workerModule = await resolveWorkerModule(process.env.WORKER_EXECUTION_MODE);
  const app = await NestFactory.createApplicationContext(workerModule, {
    logger: createApplicationLogger({ environment: process.env.NODE_ENV }),
  });
  app.enableShutdownHooks();
}

async function resolveWorkerModule(executionMode: string | undefined): Promise<Type<unknown>> {
  if (executionMode === 'relay-only') return WorkerModule;
  // The purge runtime must not load relay or LLM provider modules.
  if (executionMode === 'document-purge') {
    return (await import('./worker/document-purge-worker.module')).DocumentPurgeWorkerModule;
  }
  return (await import('./worker/legacy-worker.module')).LegacyWorkerModule;
}

if (require.main === module) {
  void bootstrapWorker().catch(() => {
    createApplicationLogger({ environment: process.env.NODE_ENV }).error(
      { event: 'worker.bootstrap.failed', runtime: 'worker' },
      undefined,
      'WorkerBootstrap',
    );
    // A partly started context (DB pool, health server, poll timer) would
    // otherwise keep a half-initialized worker alive; fail closed instead.
    process.exit(1);
  });
}
