import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { runUp } from '../database/migrate';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  client: Client;
  stop: () => Promise<void>;
}

/**
 * Khởi động một Postgres thật qua Testcontainers, chạy toàn bộ migration SQL
 * (cùng runner production), trả về client đã kết nối.
 * Mỗi suite gọi một lần (beforeAll) để có DB sạch, độc lập.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // migrate.ts đọc cấu hình từ env → set env trỏ về container trước khi migrate
  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();
  process.env.DB_NAME = container.getDatabase();

  const migrateClient = new Client({ connectionString: container.getConnectionUri() });
  await migrateClient.connect();
  await runUp(migrateClient);
  await migrateClient.end();

  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();

  return {
    container,
    client,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}
