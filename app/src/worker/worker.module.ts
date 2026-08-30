import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApplicationConfigModule } from '../config/application-config.module';
import { TypeOrmConfigService } from '../database/typeorm-config.service';
import { AiIngestionService } from '../modules/ai/ai-ingestion.service';
import { ACCOUNT_ACCESS_REVOCATION } from '../modules/ai/contracts/account-access-revocation.port';
import { AI_INGESTION } from '../modules/ai/contracts/ai-ingestion.port';
import { AiOutboxRepository } from '../modules/ai/repositories/ai-outbox.repository';
import { ProcessingJobRepository } from '../modules/ai/repositories/processing-job.repository';
import {
  QUIZ_GENERATION_HANDOFF,
} from '../modules/assessment/contracts/quiz-generation-handoff.contract';
import { QUIZ_PERSISTENCE } from '../modules/assessment/contracts/quiz-persistence.port';
import { QuizGenerationHandoffService } from '../modules/assessment/quiz-generation-handoff.service';
import { QuizRepository } from '../modules/assessment/repositories/quiz.repository';
import { DOCUMENT_STATUS_PROJECTION } from '../modules/content/contracts/document-status-projection.port';
import { DocumentStatusProjectionService } from '../modules/content/document-status-projection.service';
import { ForwardRelay } from '../modules/content/forward-relay.service';
import { ContentRepository } from '../modules/content/repositories/content.repository';
import { CourseOutboxRepository } from '../modules/content/repositories/course-outbox.repository';
import { WorkerHealthServer } from './worker-health-server.service';
import { WorkerRunner } from './worker-runner.service';
import { ReturnRelay } from './return-relay.service';
import { AuthCancellationRelay } from './auth-cancellation-relay.service';
import { AuthOutboxRepository } from '../modules/auth/repositories/auth-outbox.repository';

@Module({
  imports: [
    ApplicationConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ApplicationConfigModule],
      useClass: TypeOrmConfigService,
    }),
  ],
  providers: [
    AuthCancellationRelay,
    AuthOutboxRepository,
    AiIngestionService,
    AiOutboxRepository,
    ContentRepository,
    CourseOutboxRepository,
    DocumentStatusProjectionService,
    ForwardRelay,
    ProcessingJobRepository,
    QuizGenerationHandoffService,
    QuizRepository,
    ReturnRelay,
    WorkerHealthServer,
    WorkerRunner,
    { provide: ACCOUNT_ACCESS_REVOCATION, useExisting: ProcessingJobRepository },
    { provide: AI_INGESTION, useExisting: AiIngestionService },
    { provide: DOCUMENT_STATUS_PROJECTION, useExisting: DocumentStatusProjectionService },
    { provide: QUIZ_GENERATION_HANDOFF, useExisting: QuizGenerationHandoffService },
    { provide: QUIZ_PERSISTENCE, useExisting: QuizRepository },
  ],
})
export class WorkerModule {}
