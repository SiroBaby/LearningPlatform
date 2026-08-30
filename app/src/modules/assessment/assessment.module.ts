import { Module } from '@nestjs/common';

import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { QUIZ_ATTEMPT_STORE } from './contracts/quiz-attempt-store.port';
import { ATTEMPT_RESULT_READER } from './contracts/attempt-result-reader.port';
import { QUIZ_DISCOVERY } from './contracts/quiz-discovery.port';
import { QUIZ_GENERATION_HANDOFF } from './contracts/quiz-generation-handoff.contract';
import { QUIZ_PERSISTENCE } from './contracts/quiz-persistence.port';
import { AssessmentMappingProfile } from './mappings/assessment-mapping.profile';
import { QuizGenerationHandoffService } from './quiz-generation-handoff.service';
import { QuizRepository } from './repositories/quiz.repository';
import { AttemptResultRepository } from './repositories/attempt-result.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AssessmentController],
  providers: [
    QuizRepository,
    AttemptResultRepository,
    AssessmentService,
    AssessmentMappingProfile,
    QuizGenerationHandoffService,
    { provide: QUIZ_ATTEMPT_STORE, useExisting: QuizRepository },
    { provide: ATTEMPT_RESULT_READER, useExisting: AttemptResultRepository },
    { provide: QUIZ_DISCOVERY, useExisting: QuizRepository },
    { provide: QUIZ_PERSISTENCE, useExisting: QuizRepository },
    { provide: QUIZ_GENERATION_HANDOFF, useExisting: QuizGenerationHandoffService },
  ],
  exports: [QUIZ_DISCOVERY, QUIZ_GENERATION_HANDOFF],
})
export class AssessmentModule {}
