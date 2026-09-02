import { DataSource } from 'typeorm';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { Document } from '../modules/content/entities/document.entity';
import { OutboxEvent } from '../modules/content/entities/outbox-event.entity';
import { AuthOutboxEvent } from '../modules/auth/entities/auth-outbox-event.entity';
import { OAuthTransaction } from '../modules/auth/entities/oauth-transaction.entity';
import { Session } from '../modules/auth/entities/session.entity';
import { UserProfile } from '../modules/auth/entities/user-profile.entity';
import { User } from '../modules/auth/entities/user.entity';
import { ProcessingJob } from '../modules/ai/entities/processing-job.entity';
import { AiOutboxEvent } from '../modules/ai/entities/ai-outbox-event.entity';
import { Chunk } from '../modules/ai/entities/chunk.entity';
import { GenerationCacheRecord } from '../modules/ai/entities/generation-cache.entity';
import { PromptVersion } from '../modules/ai/entities/prompt-version.entity';
import { AttemptAnswerEntity } from '../modules/assessment/entities/attempt-answer.entity';
import { AttemptEntity } from '../modules/assessment/entities/attempt.entity';
import { QuestionEntity } from '../modules/assessment/entities/question.entity';
import { QuestionOptionEntity } from '../modules/assessment/entities/question-option.entity';
import { QuizEntity } from '../modules/assessment/entities/quiz.entity';

/**
 * DataSource TypeORM trỏ vào container test (migration đã chạy sẵn).
 * synchronize=false: schema do migration SQL thuần dựng, không để TypeORM tạo.
 */
export async function createTestDataSource(
  container: StartedPostgreSqlContainer,
): Promise<DataSource> {
  const ds = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    entities: [
      AiOutboxEvent,
      AuthOutboxEvent,
      AttemptAnswerEntity,
      AttemptEntity,
      Chunk,
      Document,
      GenerationCacheRecord,
      OAuthTransaction,
      OutboxEvent,
      ProcessingJob,
      PromptVersion,
      QuestionEntity,
      QuestionOptionEntity,
      QuizEntity,
      Session,
      User,
      UserProfile,
    ],
    synchronize: false,
  });
  await ds.initialize();
  return ds;
}
