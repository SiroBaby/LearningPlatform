import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { MappingModule } from '../../common/mapping/mapping.module';
import { AssessmentModule } from './assessment.module';
import { QUIZ_ATTEMPT_STORE, type QuizAttemptStore } from './contracts/quiz-attempt-store.port';
import {
  QUIZ_GENERATION_HANDOFF,
  type QuizGenerationHandoffPort,
} from './contracts/quiz-generation-handoff.contract';
import { QuizRepository } from './repositories/quiz.repository';

describe('AssessmentModule', () => {
  it('provides the assessment-owned handoff port', async () => {
    const module = await Test.createTestingModule({
      imports: [MappingModule, AssessmentModule],
    })
      .overrideProvider(QuizRepository)
      .useValue({
        findForGradingByOwnerId: async () => null,
        findServedByOwnerId: async () => null,
        persist: async () => ({
          optionCount: 0,
          questionCount: 0,
          questionIds: [],
          quizId: '',
        }),
        persistAttempt: async () => false,
      })
      .compile();

    expect(module.get<QuizGenerationHandoffPort>(QUIZ_GENERATION_HANDOFF)).toBeDefined();
    expect(module.get<QuizAttemptStore>(QUIZ_ATTEMPT_STORE)).toBeDefined();
    await module.close();
  });
});
