import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AssessmentModule } from './assessment.module';
import {
  QUIZ_GENERATION_HANDOFF,
  type QuizGenerationHandoffPort,
} from './contracts/quiz-generation-handoff.contract';
import { QuizRepository } from './repositories/quiz.repository';

describe('AssessmentModule', () => {
  it('provides the assessment-owned handoff port', async () => {
    const module = await Test.createTestingModule({
      imports: [AssessmentModule],
    })
      .overrideProvider(QuizRepository)
      .useValue({
        persist: async () => ({
          optionCount: 0,
          questionCount: 0,
          questionIds: [],
          quizId: '',
        }),
      })
      .compile();

    expect(module.get<QuizGenerationHandoffPort>(QUIZ_GENERATION_HANDOFF)).toBeDefined();
    await module.close();
  });
});
