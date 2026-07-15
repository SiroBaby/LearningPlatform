import { DataSource } from 'typeorm';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { Document } from '../modules/content/entities/document.entity';
import { OutboxEvent } from '../modules/content/entities/outbox-event.entity';
import { ProcessingJob } from '../modules/ai/entities/processing-job.entity';
import { AiOutboxEvent } from '../modules/ai/entities/ai-outbox-event.entity';
import { Chunk } from '../modules/ai/entities/chunk.entity';
import { GenerationCacheRecord } from '../modules/ai/entities/generation-cache.entity';
import { PromptVersion } from '../modules/ai/entities/prompt-version.entity';
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
      Chunk,
      Document,
      GenerationCacheRecord,
      OutboxEvent,
      ProcessingJob,
      PromptVersion,
      QuestionEntity,
      QuestionOptionEntity,
      QuizEntity,
    ],
    synchronize: false,
  });
  await ds.initialize();
  return ds;
}
