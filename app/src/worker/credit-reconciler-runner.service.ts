import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';
import { CreditReconcilerService } from '../modules/content/credit-reconciler.service';

/** Consecutive failed runs double the delay up to this multiple of the interval. */
const MAX_FAILURE_BACKOFF_MULTIPLIER = 8;

/**
 * Timer loop of the credit reconciler inside the relay-only `worker` runtime. It owns its own timer chain, so a
 * slow or failing run never delays the relay pump, and nothing happens while the flag is off.
 */
@Injectable()
export class CreditReconcilerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = createApplicationLogger({ context: CreditReconcilerRunner.name });
  private readonly shutdownSignal = new AbortController();
  private activeRun: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private consecutiveFailureCount = 0;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly reconciler: CreditReconcilerService,
  ) {}

  onApplicationBootstrap(): void {
    const settings = this.config.creditReconciler;
    if (!settings.enabled) {
      this.logger.log({ event: 'credit.reconcile.disabled', runtime: 'worker' });
      return;
    }
    this.logger.log({
      event: 'credit.reconcile.enabled',
      mode: settings.dryRun ? 'dry-run' : 'apply',
      runtime: 'worker',
    });
    // Timer based: the first run must not delay worker readiness or the relay pump.
    this.scheduleRun(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shutdownSignal.abort();
    if (this.timer) clearTimeout(this.timer);
    await this.activeRun;
  }

  private scheduleRun(delayMs: number): void {
    this.timer = setTimeout(() => void this.run(), delayMs);
  }

  private async run(): Promise<void> {
    if (this.shutdownSignal.signal.aborted) return;
    this.activeRun = this.reconciler.reconcileOnce(this.shutdownSignal.signal).then((report) => {
      this.consecutiveFailureCount = report.outcome === 'FAILED' ? this.consecutiveFailureCount + 1 : 0;
    });
    await this.activeRun;
    this.activeRun = undefined;
    if (!this.shutdownSignal.signal.aborted) {
      this.scheduleRun(this.nextDelayMs());
    }
  }

  /** Doubles per consecutive failure (capped), so a broken run is not retried at full rate forever. */
  private nextDelayMs(): number {
    const { intervalMs } = this.config.creditReconciler;
    const multiplier = Math.min(2 ** this.consecutiveFailureCount, MAX_FAILURE_BACKOFF_MULTIPLIER);
    return intervalMs * multiplier;
  }
}
