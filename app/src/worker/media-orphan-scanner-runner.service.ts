import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';
import { MediaOrphanScannerService } from '../modules/content/media-orphan-scanner.service';

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
    this.activeScan = this.scanner.scanOnce(this.shutdownSignal.signal).then(() => undefined);
    await this.activeScan;
    this.activeScan = undefined;
    if (!this.shutdownSignal.signal.aborted) {
      this.scheduleScan(this.config.mediaOrphanScanner.intervalMs);
    }
  }
}
