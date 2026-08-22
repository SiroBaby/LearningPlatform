import { randomUUID } from 'crypto';

import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';
import { ForwardRelay } from '../modules/content/forward-relay.service';
import { ReturnRelay } from './return-relay.service';

@Injectable()
export class WorkerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = createApplicationLogger({ context: WorkerRunner.name });
  private activeRun: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly relay: ForwardRelay,
    private readonly returnRelay: ReturnRelay,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log({ event: 'worker.started', runtime: 'worker' });
    await this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.logger.log({ event: 'worker.shutdown.drain', runtime: 'worker' });
    await this.activeRun;
    this.logger.log({ event: 'worker.shutdown.completed', runtime: 'worker' });
  }

  private async run(): Promise<void> {
    if (this.stopping) return;

    const worker = this.config.worker;
    const cycleId = randomUUID();
    let delayMs = worker.pollIntervalMs;
    this.activeRun = (async (): Promise<void> => {
      try {
        await this.relay.pump(worker.outboxBatchSize);
        await this.returnRelay.pump(worker.outboxBatchSize);
      } catch {
        delayMs = worker.errorBackoffMs;
        this.logger.error({ cycleId, event: 'worker.cycle.failed', runtime: 'worker' });
        this.logger.warn({
          cycleId,
          delayMs,
          event: 'worker.cycle.backoff',
          runtime: 'worker',
        });
      }
    })();
    await this.activeRun;
    this.activeRun = undefined;

    if (!this.stopping) {
      this.timer = setTimeout(() => void this.run(), delayMs);
    }
  }
}
