import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { ApplicationConfigService } from '../config/application-config.service';
import { JobPoller } from '../modules/ai/job-poller.service';
import { StuckJobDetector } from '../modules/ai/stuck-job-detector.service';
import { ForwardRelay } from '../modules/content/forward-relay.service';
import { ReturnRelay } from './return-relay.service';

@Injectable()
export class WorkerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerRunner.name);
  private activeRun: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly relay: ForwardRelay,
    private readonly poller: JobPoller,
    private readonly returnRelay: ReturnRelay,
    private readonly stuckJobs: StuckJobDetector,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.activeRun;
  }

  private async run(): Promise<void> {
    if (this.stopping) return;

    const worker = this.config.worker;
    let delayMs = worker.pollIntervalMs;
    this.activeRun = (async (): Promise<void> => {
      try {
        await this.relay.pump(worker.outboxBatchSize);
        for (let index = 0; index < worker.jobBatchSize; index += 1) {
          if (!(await this.poller.tick())) break;
        }
        await this.stuckJobs.detectAndFail(
          worker.stuckJobTimeoutMs,
          worker.stuckJobBatchSize,
        );
        await this.returnRelay.pump(worker.outboxBatchSize);
      } catch {
        delayMs = worker.errorBackoffMs;
        this.logger.error('Worker cycle failed');
      }
    })();
    await this.activeRun;
    this.activeRun = undefined;

    if (!this.stopping) {
      this.timer = setTimeout(() => void this.run(), delayMs);
    }
  }
}
