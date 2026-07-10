import { Module } from '@nestjs/common';

import { ContentController } from './content.controller';
import { ContentService } from './content.service';
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
    ContentRepository,
    CourseOutboxRepository,
    ContentMappingProfile,
    ForwardRelay,
  ],
  exports: [ContentService],
})
export class ContentModule {}
