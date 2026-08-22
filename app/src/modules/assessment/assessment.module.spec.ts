import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { MappingModule } from '../../common/mapping/mapping.module';
import { AssessmentModule } from './assessment.module';
import { QUIZ_ATTEMPT_STORE, type QuizAttemptStore } from './contracts/quiz-attempt-store.port';
import { ATTEMPT_RESULT_READER, type AttemptResultReader } from './contracts/attempt-result-reader.port';
import {
  QUIZ_GENERATION_HANDOFF,
  type QuizGenerationHandoffPort,
} from './contracts/quiz-generation-handoff.contract';
import { QuizRepository } from './repositories/quiz.repository';
import { AttemptResultRepository } from './repositories/attempt-result.repository';

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
      .overrideProvider(AttemptResultRepository)
      .useValue({ findByOwnerQuizAndAttemptId: async () => null })
      .compile();

    expect(module.get<QuizGenerationHandoffPort>(QUIZ_GENERATION_HANDOFF)).toBeDefined();
    expect(module.get<QuizAttemptStore>(QUIZ_ATTEMPT_STORE)).toBeDefined();
    expect(module.get<AttemptResultReader>(ATTEMPT_RESULT_READER)).toBeDefined();
    await module.close();
  });
});
