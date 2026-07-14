import { Module } from '@nestjs/common';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { DOCUMENT_STATUS_PROJECTION } from './contracts/document-status-projection.port';
import { DocumentStatusProjectionService } from './document-status-projection.service';
import { ForwardRelay } from './forward-relay.service';
import { AiModule } from '../ai/ai.module';
import { ContentMappingProfile } from './mappings/content-mapping.profile';
import { ContentRepository } from './repositories/content.repository';
import { CourseOutboxRepository } from './repositories/course-outbox.repository';

@Module({
  imports: [AiModule],
  controllers: [ContentController],
  providers: [
    ContentService,
    DocumentStatusProjectionService,
    ContentRepository,
    CourseOutboxRepository,
    ContentMappingProfile,
    ForwardRelay,
    {
      provide: DOCUMENT_STATUS_PROJECTION,
      useExisting: DocumentStatusProjectionService,
    },
  ],
  exports: [ContentService, DOCUMENT_STATUS_PROJECTION, ForwardRelay],
})
export class ContentModule {}
