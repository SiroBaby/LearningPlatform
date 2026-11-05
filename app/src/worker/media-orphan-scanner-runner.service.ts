import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';
import { MediaOrphanScannerService } from '../modules/content/media-orphan-scanner.service';

/** Consecutive failed runs double the delay up to this multiple of the interval. */
const MAX_FAILURE_BACKOFF_MULTIPLIER = 8;

/**
 * Timer loop of the media orphan scanner inside the document-purge runtime.
 * It is independent of the purge poll loop: a failing or slow scan never
 * delays purging, and nothing happens while the flag is off.
 */
@Injectable()
export class MediaOrphanScannerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = createApplicationLogger({ context: MediaOrphanScannerRunner.name });
  private readonly shutdownSignal = new AbortController();
  private activeScan: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private consecutiveFailureCount = 0;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly scanner: MediaOrphanScannerService,
  ) {}

  onApplicationBootstrap(): void {
    const settings = this.config.mediaOrphanScanner;
    if (!settings.enabled) {
      this.logger.log({ event: 'media.orphan.scanner.disabled', runtime: 'document-purge' });
      return;
    }
    this.logger.log({
      event: 'media.orphan.scanner.enabled',
      mode: settings.deleteEnabled ? 'delete' : 'dry-run',
      runtime: 'document-purge',
    });
    // Timer based: the first scan must not delay worker readiness or the purge loop.
    this.scheduleScan(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shutdownSignal.abort();
    if (this.timer) clearTimeout(this.timer);
    await this.activeScan;
  }

  private scheduleScan(delayMs: number): void {
    this.timer = setTimeout(() => void this.runScan(), delayMs);
  }

  private async runScan(): Promise<void> {
    if (this.shutdownSignal.signal.aborted) return;
    this.activeScan = this.scanner.scanOnce(this.shutdownSignal.signal).then((report) => {
      this.consecutiveFailureCount = report.outcome === 'FAILED' ? this.consecutiveFailureCount + 1 : 0;
    });
    await this.activeScan;
    this.activeScan = undefined;
    if (!this.shutdownSignal.signal.aborted) {
      this.scheduleScan(this.nextDelayMs());
    }
  }

  /** Doubles per consecutive failure (capped), so a denied or broken scan is not retried hourly forever. */
  private nextDelayMs(): number {
    const { intervalMs } = this.config.mediaOrphanScanner;
    const multiplier = Math.min(2 ** this.consecutiveFailureCount, MAX_FAILURE_BACKOFF_MULTIPLIER);
    return intervalMs * multiplier;
  }
}
