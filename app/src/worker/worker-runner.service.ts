import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { ApplicationConfigService } from '../config/application-config.service';
import { JobPoller } from '../modules/ai/job-poller.service';
import { ForwardRelay } from '../modules/content/forward-relay.service';

@Injectable()
export class WorkerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly relay: ForwardRelay,
    private readonly poller: JobPoller,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async run(): Promise<void> {
    if (this.stopping) return;

    const worker = this.config.worker;
    let delayMs = worker.pollIntervalMs;
    try {
      await this.relay.pump(worker.outboxBatchSize);
      for (let index = 0; index < worker.jobBatchSize; index += 1) {
        if (!(await this.poller.tick())) break;
      }
    } catch (error) {
      delayMs = worker.errorBackoffMs;
      this.logger.error('Worker cycle failed', error);
    }

    if (!this.stopping) {
      this.timer = setTimeout(() => void this.run(), delayMs);
    }
  }
}
