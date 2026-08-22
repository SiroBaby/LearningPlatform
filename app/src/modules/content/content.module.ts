import { forwardRef, Module } from '@nestjs/common';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { DOCUMENT_STATUS_PROJECTION } from './contracts/document-status-projection.port';
import { DocumentStatusProjectionService } from './document-status-projection.service';
import { ForwardRelay } from './forward-relay.service';
import { AiModule } from '../ai/ai.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { DOCUMENT_SOURCE_READER } from '../ai/contracts/extraction.contracts';
import { ContentDocumentSourceReader } from './document-source-reader.service';
import { ContentMappingProfile } from './mappings/content-mapping.profile';
import { ContentRepository } from './repositories/content.repository';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';
import { BudgetReservationRepository } from './repositories/budget-reservation.repository';
import { BUDGET_RESERVATION } from './contracts/budget-reservation.port';
import { OwnerEntitlementRepository } from './repositories/owner-entitlement.repository';
import { OWNER_ENTITLEMENTS } from './contracts/owner-entitlement.port';

@Module({
  imports: [AssessmentModule, forwardRef(() => AiModule)],
  controllers: [ContentController],
  providers: [
    ContentService,
    DocumentStatusProjectionService,
    ContentRepository,
    CourseOutboxRepository,
    BudgetReservationRepository,
    OwnerEntitlementRepository,
    ContentMappingProfile,
    ForwardRelay,
    ContentDocumentSourceReader,
    {
      provide: DOCUMENT_STATUS_PROJECTION,
      useExisting: DocumentStatusProjectionService,
    },
    { provide: DOCUMENT_SOURCE_READER, useExisting: ContentDocumentSourceReader },
    { provide: BUDGET_RESERVATION, useExisting: BudgetReservationRepository },
    { provide: OWNER_ENTITLEMENTS, useExisting: OwnerEntitlementRepository },
  ],
  exports: [BUDGET_RESERVATION, ContentService, DOCUMENT_STATUS_PROJECTION, DOCUMENT_SOURCE_READER, ForwardRelay, OWNER_ENTITLEMENTS],
})
export class ContentModule {}
