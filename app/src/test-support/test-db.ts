import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

import { runUp } from '../database/migrate';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  client: Client;
  stop: () => Promise<void>;
}

const TEST_DATABASE_ENVIRONMENT_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

type TestDatabaseEnvironmentKey = (typeof TEST_DATABASE_ENVIRONMENT_KEYS)[number];
type TestDatabaseEnvironmentSnapshot = ReadonlyMap<TestDatabaseEnvironmentKey, string | undefined>;

/**
 * Khởi động một Postgres thật qua Testcontainers, chạy toàn bộ migration SQL
 * (cùng runner production), trả về client đã kết nối.
 * Mỗi suite gọi một lần (beforeAll) để có DB sạch, độc lập.
 */
export async function startTestDatabase(): Promise<TestDb> {
  const originalEnvironment = snapshotTestDatabaseEnvironment();
  let container: StartedPostgreSqlContainer | undefined;
  let migrateClient: Client | undefined;
  let client: Client | undefined;

  try {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    // migrate.ts đọc cấu hình từ env -> set env trỏ về container trước khi migrate
    process.env.DB_HOST = container.getHost();
    process.env.DB_PORT = String(container.getPort());
    process.env.DB_USER = container.getUsername();
    process.env.DB_PASSWORD = container.getPassword();
    process.env.DB_NAME = container.getDatabase();

    migrateClient = new Client({ connectionString: container.getConnectionUri() });
    await migrateClient.connect();
    await runUp(migrateClient);
    await migrateClient.end();
    migrateClient = undefined;

    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    const connectedClient = client;
    const startedContainer = container;
    let stopped = false;

    return {
      container: startedContainer,
      client: connectedClient,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        let cleanupError: unknown;
        try {
          await connectedClient.end();
        } catch (error) {
          cleanupError = error;
        }
        try {
          await startedContainer.stop();
        } catch (error) {
          cleanupError ??= error;
        } finally {
          restoreTestDatabaseEnvironment(originalEnvironment);
        }
        if (cleanupError) throw cleanupError;
      },
    };
  } catch (error) {
    let cleanupError: unknown;
    if (migrateClient) {
      try {
        await migrateClient.end();
      } catch (closeError) {
        cleanupError = closeError;
      }
    }
    if (client) {
      try {
        await client.end();
      } catch (closeError) {
        cleanupError ??= closeError;
      }
    }
    if (container) {
      try {
        await container.stop();
      } catch (stopError) {
        cleanupError ??= stopError;
      }
    }
    restoreTestDatabaseEnvironment(originalEnvironment);
    if (cleanupError) throw new AggregateError([error, cleanupError], 'Test database cleanup failed');
    throw error;
  }
}

/** Stop a test database and restore the caller's database environment. */
export async function stopTestDatabase(testDb: TestDb | undefined): Promise<void> {
  if (testDb) await testDb.stop();
}

/** Backward-compatible name used by existing integration suites. */
export async function startTestDb(): Promise<TestDb> {
  return startTestDatabase();
}

function snapshotTestDatabaseEnvironment(): TestDatabaseEnvironmentSnapshot {
  return new Map(TEST_DATABASE_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
}

function restoreTestDatabaseEnvironment(snapshot: TestDatabaseEnvironmentSnapshot): void {
  for (const key of TEST_DATABASE_ENVIRONMENT_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
