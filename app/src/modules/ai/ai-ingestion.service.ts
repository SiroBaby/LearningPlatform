import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  AiIngestion,
  EnqueueCommand,
  MEDIA_PROBE_JOB_TYPE,
  type DocumentCancellationCommand,
} from './contracts/ai-ingestion.port';
import { normalizeStorageVersionId } from '../../storage/storage-version-id';
import { MediaProbeJobRepository } from './repositories/media-probe-job.repository';
import { ProcessingJobRepository } from './repositories/processing-job.repository';

@Injectable()
export class AiIngestionService implements AiIngestion {
  constructor(
    private readonly processingJobs: ProcessingJobRepository,
    @Optional() private readonly mediaProbeJobs?: MediaProbeJobRepository,
  ) {}

  async cancelDocument(command: DocumentCancellationCommand): Promise<void> {
    await this.mediaProbeJobs?.cancelDocument(command);
    await this.processingJobs.cancelDocument(command);
  }

  async enqueue(cmd: EnqueueCommand): Promise<void> {
    if (cmd.jobType === MEDIA_PROBE_JOB_TYPE) {
      if (
        !cmd.probeGeneration ||
        !cmd.policyVersion ||
        !cmd.fullPipelineJobId ||
        !cmd.sourceBucket ||
        !cmd.sourceKey ||
        cmd.deletionFence === undefined
      ) {
        throw new Error('MEDIA_PROBE requires probeGeneration, policyVersion, managed source key and deletionFence');
      }
      const hasSourceLocator = cmd.sourceVersionId !== undefined ||
        cmd.sourceEtag !== undefined ||
        cmd.sourceContentLength !== undefined;
      if (
        hasSourceLocator &&
        (!normalizeStorageVersionId(cmd.sourceVersionId) ||
          !cmd.sourceEtag?.trim() ||
          !Number.isSafeInteger(cmd.sourceContentLength) ||
          (cmd.sourceContentLength as number) < 0)
      ) {
        throw new Error('MEDIA_PROBE source locator must be complete');
      }
      if (!this.mediaProbeJobs) {
        throw new Error('Media probe ingestion is unavailable');
      }
      await this.mediaProbeJobs.enqueue(cmd, this.buildMediaProbeKey(cmd));
      return;
    }

    await this.processingJobs.enqueue(cmd, this.buildFullPipelineKey(cmd));
  }

  private buildFullPipelineKey(cmd: Extract<EnqueueCommand, { jobType: 'FULL_PIPELINE' }>): string {
    return createHash('sha256')
      .update(`${cmd.documentId}:${cmd.jobType}`)
      .digest('hex')
      .slice(0, 64);
  }

  private buildMediaProbeKey(cmd: EnqueueCommand): string {
    if (cmd.jobType !== MEDIA_PROBE_JOB_TYPE) {
      throw new Error('Media probe idempotency key requires a media probe command');
    }
    return createHash('sha256')
      .update(`${cmd.documentId}:${cmd.probeGeneration}:${cmd.policyVersion}`)
      .digest('hex')
      .slice(0, 64);
  }
}
