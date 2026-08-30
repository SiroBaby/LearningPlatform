import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';

import { MappingModule } from '../../common/mapping/mapping.module';
import { ApplicationConfigModule } from '../../config/application-config.module';
import { AssessmentModule } from './assessment.module';
import { QUIZ_ATTEMPT_STORE, type QuizAttemptStore } from './contracts/quiz-attempt-store.port';
import { ATTEMPT_RESULT_READER, type AttemptResultReader } from './contracts/attempt-result-reader.port';
import {
  QUIZ_GENERATION_HANDOFF,
  type QuizGenerationHandoffPort,
} from './contracts/quiz-generation-handoff.contract';
import { QuizRepository } from './repositories/quiz.repository';
import { AttemptResultRepository } from './repositories/attempt-result.repository';
import { AuthRepository } from '../auth/repositories/auth.repository';
import { AuthOutboxRepository } from '../auth/repositories/auth-outbox.repository';
import { GoogleOAuthClientProvider, type GoogleOAuthProvider } from '../auth/google-oauth.provider';

const googleOAuthProviderStub: GoogleOAuthProvider = {
  authorizationUrl: () => 'https://oauth.test/authorize',
  exchangeCode: async () => 'test-id-token',
  verifyIdToken: async () => undefined,
};

describe('AssessmentModule', () => {
  it('provides assessment ports without requiring local OAuth configuration', async () => {
    const dataSourceMock = {
      entityMetadatas: [],
      getRepository: () => ({}),
      options: { type: 'postgres' },
    };
    const module = await Test.createTestingModule({
      imports: [
        ApplicationConfigModule,
        MappingModule,
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            type: 'postgres',
            manualInitialization: true,
          }),
          dataSourceFactory: async () => dataSourceMock as never,
        }),
        AssessmentModule,
      ],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSourceMock)
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
      .overrideProvider(AuthRepository)
      .useValue({})
      .overrideProvider(AuthOutboxRepository)
      .useValue({})
      .overrideProvider(GoogleOAuthClientProvider)
      .useValue(googleOAuthProviderStub)
      .compile();

    expect(module.get(GoogleOAuthClientProvider)).toBe(googleOAuthProviderStub);
    expect(module.get<QuizGenerationHandoffPort>(QUIZ_GENERATION_HANDOFF)).toBeDefined();
    expect(module.get<QuizAttemptStore>(QUIZ_ATTEMPT_STORE)).toBeDefined();
    expect(module.get<AttemptResultReader>(ATTEMPT_RESULT_READER)).toBeDefined();
    await module.close();
  });
});
