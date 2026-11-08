import { describe, expect, it } from '@jest/globals';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AiModule } from '../modules/ai/ai.module';
import { LlmProviderModule } from '../modules/ai/llm-provider.module';
import { JobPoller } from '../modules/ai/job-poller.service';
import { StuckJobDetector } from '../modules/ai/stuck-job-detector.service';
import { WorkerModule } from './worker.module';
import { WorkerRunner } from './worker-runner.service';
import { AuthCancellationRelay } from './auth-cancellation-relay.service';
import { CreditReconcilerRunner } from './credit-reconciler-runner.service';
import { PROCESSING_SETTLEMENT_FACTS } from '../modules/ai/contracts/processing-settlement-facts.port';
import { CreditReconcilerService } from '../modules/content/credit-reconciler.service';
import { CreditReconciliationRepository } from '../modules/content/repositories/credit-reconciliation.repository';
import { ProcessingJobRepository } from '../modules/ai/repositories/processing-job.repository';

describe('WorkerModule', () => {
  it('contains only the relay provider graph', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, WorkerModule) as readonly unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkerModule) as readonly unknown[];

    expect(imports).not.toContain(AiModule);
    expect(imports).not.toContain(LlmProviderModule);
    expect(providers).not.toContain(JobPoller);
    expect(providers).not.toContain(StuckJobDetector);
    expect(providers).toContain(WorkerRunner);
    expect(providers).toContain(AuthCancellationRelay);
  });

  it('hosts the credit reconciler with the AI-owned settlement facts port', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkerModule) as readonly unknown[];

    expect(providers).toEqual(expect.arrayContaining([
      CreditReconcilerRunner,
      CreditReconcilerService,
      CreditReconciliationRepository,
      { provide: PROCESSING_SETTLEMENT_FACTS, useExisting: ProcessingJobRepository },
    ]));
  });
});
