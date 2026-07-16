import { Module } from '@nestjs/common';

import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { QUIZ_ATTEMPT_STORE } from './contracts/quiz-attempt-store.port';
import { QUIZ_GENERATION_HANDOFF } from './contracts/quiz-generation-handoff.contract';
import { QUIZ_PERSISTENCE } from './contracts/quiz-persistence.port';
import { AssessmentMappingProfile } from './mappings/assessment-mapping.profile';
import { QuizGenerationHandoffService } from './quiz-generation-handoff.service';
import { QuizRepository } from './repositories/quiz.repository';

@Module({
  controllers: [AssessmentController],
  providers: [
    QuizRepository,
    AssessmentService,
    AssessmentMappingProfile,
    QuizGenerationHandoffService,
    { provide: QUIZ_ATTEMPT_STORE, useExisting: QuizRepository },
    { provide: QUIZ_PERSISTENCE, useExisting: QuizRepository },
    { provide: QUIZ_GENERATION_HANDOFF, useExisting: QuizGenerationHandoffService },
  ],
  exports: [QUIZ_GENERATION_HANDOFF],
})
export class AssessmentModule {}
