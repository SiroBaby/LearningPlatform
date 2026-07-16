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

@Module({
  imports: [AssessmentModule, forwardRef(() => AiModule)],
  controllers: [ContentController],
  providers: [
    ContentService,
    DocumentStatusProjectionService,
    ContentRepository,
    CourseOutboxRepository,
    ContentMappingProfile,
    ForwardRelay,
    ContentDocumentSourceReader,
    {
      provide: DOCUMENT_STATUS_PROJECTION,
      useExisting: DocumentStatusProjectionService,
    },
    { provide: DOCUMENT_SOURCE_READER, useExisting: ContentDocumentSourceReader },
  ],
  exports: [ContentService, DOCUMENT_STATUS_PROJECTION, DOCUMENT_SOURCE_READER, ForwardRelay],
})
export class ContentModule {}
