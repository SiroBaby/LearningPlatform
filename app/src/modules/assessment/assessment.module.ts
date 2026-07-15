import { Module } from '@nestjs/common';

import { QUIZ_GENERATION_HANDOFF } from './contracts/quiz-generation-handoff.contract';
import { QUIZ_PERSISTENCE } from './contracts/quiz-persistence.port';
import { QuizGenerationHandoffService } from './quiz-generation-handoff.service';
import { QuizRepository } from './repositories/quiz.repository';

@Module({
  providers: [
    QuizRepository,
    QuizGenerationHandoffService,
    { provide: QUIZ_PERSISTENCE, useExisting: QuizRepository },
    { provide: QUIZ_GENERATION_HANDOFF, useExisting: QuizGenerationHandoffService },
  ],
  exports: [QUIZ_GENERATION_HANDOFF],
})
export class AssessmentModule {}
