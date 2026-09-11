import { Inject, Injectable } from '@nestjs/common';

import {
  AI_INGESTION,
  AiIngestion,
  MEDIA_PROBE_JOB_TYPE,
} from '../ai/contracts/ai-ingestion.port';
import { JobType } from '../ai/enums/job-type.enum';
import type { DocumentModelSelection } from '../ai/contracts/model-selection.contracts';
import { normalizeStorageVersionId } from '../../storage/storage-version-id';
import { ContentRepository } from './repositories/content.repository';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';
import { DocumentStatus } from './enums/document-status.enum';

/**
 * Forward relay (infra của course): đọc course.outbox chưa publish ->
 * gọi ingestion port của ai -> đánh dấu published (ADR-0002/0019).
 *
 * At-least-once (ADR-0012): enqueue (idempotent) TRƯỚC, mark published SAU,
 * ở hai bước tách rời. Crash giữa hai bước -> row chưa published -> pump lại
 * -> enqueue idempotent không tạo trùng -> rồi mới mark.
 * KHÔNG gói hai schema trong một TX (no-cross-schema-TX, ADR-0010).
 */
@Injectable()
export class ForwardRelay {
  constructor(
    private readonly outbox: CourseOutboxRepository,
    private readonly documents: ContentRepository,
    @Inject(AI_INGESTION)
    private readonly ingestion: AiIngestion,
  ) {}

  async pump(limit: number): Promise<void> {
    const pending = await this.outbox.findUnpublished(limit);

    for (const row of pending) {
      const payload = row.payload as {
        readonly customModelConfigId: string | null;
        readonly documentId: string;
        readonly kind: DocumentModelSelection['kind'];
        readonly ownerId: string;
        readonly jobType: string;
        readonly platformModelId: string | null;
        readonly fullPipelineJobId?: string;
        readonly probeResultId?: string;
        readonly probeGeneration?: string;
        readonly policyVersion?: string;
        readonly deletionFence?: number;
        readonly processingAttempt?: number;
        readonly sourceBucket?: string;
        readonly sourceKey?: string;
        readonly sourceVersionId?: string;
        readonly sourceEtag?: string;
        readonly sourceContentLength?: number;
        readonly reason?: 'DOCUMENT_DELETED';
      };

      if (row.eventType === 'DocumentProcessingCancelled') {
        if (
          !payload.documentId ||
          !payload.ownerId ||
          payload.deletionFence === undefined ||
          payload.reason !== 'DOCUMENT_DELETED'
        ) {
          throw new Error('Invalid document cancellation payload');
        }
        await this.ingestion.cancelDocument({
          deletionFence: payload.deletionFence,
          documentId: payload.documentId,
          ownerId: payload.ownerId,
          reason: payload.reason,
        });
        await this.outbox.markPublished(row.id);
        continue;
      }

      if (row.eventType !== 'DocumentProbeRequested' && row.eventType !== 'DocumentReadyForProcessing') {
        throw new Error('Invalid processing request event');
      }

      const expectedStatus = row.eventType === 'DocumentProbeRequested'
        ? DocumentStatus.PROBING
        : DocumentStatus.PROCESSING;
      if (!await this.documents.isForwardableDocumentEvent(
        payload.documentId,
        payload.ownerId,
        expectedStatus,
        payload.deletionFence,
        {
          fullPipelineJobId: payload.fullPipelineJobId,
          policyVersion: payload.policyVersion,
          processingAttempt: payload.processingAttempt,
          probeGeneration: payload.probeGeneration,
          requireProbeIdentity: row.eventType === 'DocumentProbeRequested',
        },
      )) {
        // Deletion or a newer processing attempt won the course-side fence.
        // The stale event is safe to acknowledge without touching ai.*.
        await this.outbox.markPublished(row.id);
        continue;
      }

      // Bước 1: enqueue idempotent vào đúng bảng AI của loại công việc.
      if (payload.jobType === MEDIA_PROBE_JOB_TYPE) {
        const sourceVersionId = normalizeStorageVersionId(payload.sourceVersionId);
        if (
          !payload.fullPipelineJobId ||
          !payload.probeGeneration ||
          !payload.policyVersion ||
          payload.deletionFence === undefined ||
          !payload.sourceBucket ||
          !payload.sourceKey ||
          sourceVersionId === undefined ||
          !payload.sourceEtag ||
          payload.sourceContentLength === undefined ||
          !Number.isSafeInteger(payload.sourceContentLength) ||
          payload.sourceContentLength < 0
        ) {
          throw new Error('Invalid media probe request payload');
        }
        await this.ingestion.enqueue({
          correlationId: row.aggregateId,
          deletionFence: payload.deletionFence,
          documentId: payload.documentId,
          fullPipelineJobId: payload.fullPipelineJobId,
          jobType: MEDIA_PROBE_JOB_TYPE,
          ownerId: payload.ownerId,
          policyVersion: payload.policyVersion,
          probeGeneration: payload.probeGeneration,
          sourceBucket: payload.sourceBucket,
          sourceKey: payload.sourceKey,
          sourceVersionId,
          sourceEtag: payload.sourceEtag,
          sourceContentLength: payload.sourceContentLength,
        });
      } else {
        if (payload.jobType !== JobType.FULL_PIPELINE) {
          throw new Error('Invalid processing request payload');
        }
        await this.ingestion.enqueue({
          correlationId: row.aggregateId,
          documentId: payload.documentId,
          fullPipelineJobId: payload.fullPipelineJobId,
          jobType: JobType.FULL_PIPELINE,
          ownerId: payload.ownerId,
          probeResultId: payload.probeResultId,
          probeGeneration: payload.probeGeneration,
          policyVersion: payload.policyVersion,
          deletionFence: payload.deletionFence,
          processingAttempt: payload.processingAttempt,
          selection: {
            customModelConfigId: payload.customModelConfigId,
            kind: payload.kind,
            platformModelId: payload.platformModelId,
          },
        });
      }

      // Bước 2: mark published (schema course, TX riêng)
      await this.outbox.markPublished(row.id);
    }
  }
}
