import { randomUUID } from 'crypto';

import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';

import { createApplicationLogger } from '../common/logging/application-logger.factory';
import { ApplicationConfigService } from '../config/application-config.service';
import { DocumentPurgeStorageError } from '../modules/content/contracts/document-purge-storage.port';
import { DocumentPurgeService } from '../modules/content/document-purge.service';
import type { DocumentPurgeBacklog } from '../modules/content/repositories/document-purge.repository';

/** Upper bound for one backlog read, enforced in PostgreSQL and again here. */
const BACKLOG_READ_TIMEOUT_MS = 10_000;

/** Logged when preflight fails with an error the storage adapter did not classify. */
const UNCLASSIFIED_PREFLIGHT_ERROR = 'PURGE_PREFLIGHT_UNCLASSIFIED';

/**
 * Poll loop for `WORKER_EXECUTION_MODE=document-purge`. Startup fails closed
 * when the media bucket is not versioned; cycles never overlap.
 */
@Injectable()
export class DocumentPurgeRunner implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = createApplicationLogger({ context: DocumentPurgeRunner.name });
  private activeRun: Promise<void> | undefined;
  private activeBacklogReport: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private backlogTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(
    private readonly config: ApplicationConfigService,
    private readonly purge: DocumentPurgeService,
  ) {}

  /**
   * Runs before any `onApplicationBootstrap` hook, so the health endpoint
   * never reports ready for a worker whose preflight failed.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.purge.assertMediaBucketVersioned();
    } catch (error) {
      this.logger.error({
        errorCode: error instanceof DocumentPurgeStorageError ? error.code : UNCLASSIFIED_PREFLIGHT_ERROR,
        event: 'document.purge.preflight.failed',
        runtime: 'document-purge',
      });
      throw error;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log({ event: 'document.purge.started', runtime: 'document-purge' });
    // Not awaited: backlog reporting must never delay or block the purge loop.
    void this.reportBacklog();
    await this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.backlogTimer) clearTimeout(this.backlogTimer);
    await this.activeRun;
    await this.activeBacklogReport;
    this.logger.log({ event: 'document.purge.shutdown.completed', runtime: 'document-purge' });
  }

  /**
   * Emits `document.purge.backlog` on its own timer, independent of purge
   * cycles. A failed read logs a distinct event and the loop keeps going.
   */
  private async reportBacklog(): Promise<void> {
    if (this.stopping) return;

    this.activeBacklogReport = (async (): Promise<void> => {
      try {
        const backlog = await this.readBacklogWithTimeout();
        this.logger.log({ ...backlog, event: 'document.purge.backlog', runtime: 'document-purge' });
      } catch {
        this.logger.error({ event: 'document.purge.backlog.failed', runtime: 'document-purge' });
      }
    })();
    await this.activeBacklogReport;
    this.activeBacklogReport = undefined;

    if (!this.stopping) {
      this.backlogTimer = setTimeout(
        () => void this.reportBacklog(),
        this.config.documentPurge.backlogIntervalMs,
      );
    }
  }

  /** Rejects after the timeout so a hung read cannot stall the timer chain or shutdown. */
  private async readBacklogWithTimeout(): Promise<DocumentPurgeBacklog> {
    let timeout: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('backlog read timed out')), BACKLOG_READ_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.purge.readBacklog(BACKLOG_READ_TIMEOUT_MS), expiry]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async run(): Promise<void> {
    if (this.stopping) return;

    const settings = this.config.documentPurge;
    let delayMs = settings.pollIntervalMs;
    this.activeRun = (async (): Promise<void> => {
      try {
        await this.purge.purgeDueManifests();
      } catch {
        delayMs = settings.backoffBaseMs;
        this.logger.error({
          cycleId: randomUUID(),
          delayMs,
          event: 'document.purge.cycle.failed',
          runtime: 'document-purge',
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
