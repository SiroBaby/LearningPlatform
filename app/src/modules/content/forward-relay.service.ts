import { Inject, Injectable } from '@nestjs/common';

import { AI_INGESTION, AiIngestion } from '../ai/contracts/ai-ingestion.port';
import { JobType } from '../ai/enums/job-type.enum';
import type { DocumentModelSelection } from '../ai/contracts/model-selection.contracts';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';

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
      };

      // Bước 1: enqueue idempotent (schema ai, qua port — ADR-0019)
      await this.ingestion.enqueue({
        documentId: payload.documentId,
        ownerId: payload.ownerId,
        jobType: (payload.jobType as JobType) ?? JobType.FULL_PIPELINE,
        correlationId: row.aggregateId,
        selection: {
          customModelConfigId: payload.customModelConfigId,
          kind: payload.kind,
          platformModelId: payload.platformModelId,
        },
      });

      // Bước 2: mark published (schema course, TX riêng)
      await this.outbox.markPublished(row.id);
    }
  }
}
