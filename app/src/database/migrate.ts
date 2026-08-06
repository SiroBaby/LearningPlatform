import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client, type ClientConfig } from 'pg';

loadEnv();

/**
 * Pure-SQL migration runner (độc lập với TypeORM entities).
 *
 * - Migration là cặp file SQL thuần: <timestamp>_<name>.up.sql / .down.sql
 * - Theo dõi trong bảng public.schema_migrations
 * - Advisory lock chống chạy đồng thời (nhiều pod cùng migrate)
 * - Mỗi migration chạy trong một transaction riêng
 *
 * Dùng:
 *   npm run migration:run       # chạy mọi migration chưa áp dụng
 *   npm run migration:revert    # revert migration mới nhất đã áp dụng
 *   npm run migration:status    # liệt kê trạng thái
 */

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const LOCK_KEY = 4815162342; // advisory lock id cố định cho migration
const CONNECTION_TIMEOUT_MILLIS = 10_000;
const QUERY_TIMEOUT_MILLIS = 240_000;
const LOCK_TIMEOUT_MILLIS = 30_000;
const STATEMENT_TIMEOUT_MILLIS = 240_000;
const ADVISORY_LOCK_DEADLINE_MILLIS = 60_000;
const ADVISORY_LOCK_POLL_INTERVAL_MILLIS = 1_000;
const CLEANUP_TIMEOUT_MILLIS = 5_000;
// 355s operation budget + 5s cleanup budget = 360s total, leaving 60s before terminal polling ends.
const MIGRATION_TOTAL_DEADLINE_MILLIS = 360_000;
const MIGRATION_OPERATION_DEADLINE_MILLIS = MIGRATION_TOTAL_DEADLINE_MILLIS - CLEANUP_TIMEOUT_MILLIS;
const STARTUP_OPTIONS = `-c timezone=UTC -c lock_timeout=${LOCK_TIMEOUT_MILLIS}ms -c statement_timeout=${STATEMENT_TIMEOUT_MILLIS}ms`;

interface MigrationFile {
  readonly version: string; // timestamp prefix
  readonly name: string; // <timestamp>_<name>
  readonly upPath: string;
  readonly downPath: string;
}

interface MigrationEnvironment {
  readonly DB_HOST?: string;
  readonly DB_NAME?: string;
  readonly DB_PASSWORD?: string;
  readonly DB_PORT?: string;
  readonly DB_SSL_CA?: string;
  readonly DB_SSL_MODE?: string;
  readonly DB_USER?: string;
  readonly NODE_ENV?: string;
}

export interface MigrationLockClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly { readonly acquired: boolean }[] }>;
}

interface MigrationLockOptions {
  readonly deadlineMillis?: number;
  readonly now?: () => number;
  readonly pollIntervalMillis?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface MigrationClientCleanup {
  end(): Promise<void>;
  connection: {
    stream: {
      destroy(error?: Error): void;
    };
  };
}

interface MigrationRuntimeClient extends MigrationClientCleanup {
  connect(): Promise<unknown>;
}

interface MigrationDeadlineOptions {
  readonly deadlineMillis?: number;
  readonly onDeadline?: () => void;
}

function parsePort(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error('DB_PORT must be a valid integer');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT must be a valid integer');
  }
  return port;
}

export function buildClientConfig(environment: MigrationEnvironment): ClientConfig {
  const sslMode = environment.DB_SSL_MODE ?? 'disabled';
  if (sslMode !== 'disabled' && sslMode !== 'verify-ca') {
    throw new Error('DB_SSL_MODE must be disabled or verify-ca');
  }
  if (environment.NODE_ENV === 'production' && sslMode !== 'verify-ca') {
    throw new Error('DB_SSL_MODE must be verify-ca when NODE_ENV is production');
  }
  const config: ClientConfig = {
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    database: environment.DB_NAME ?? 'learning',
    host: environment.DB_HOST ?? 'localhost',
    application_name: 'learning-platform-migration',
    lock_timeout: LOCK_TIMEOUT_MILLIS,
    options: STARTUP_OPTIONS,
    password: environment.DB_PASSWORD ?? 'learning',
    port: parsePort(environment.DB_PORT ?? '5432'),
    query_timeout: QUERY_TIMEOUT_MILLIS,
    statement_timeout: STATEMENT_TIMEOUT_MILLIS,
    user: environment.DB_USER ?? 'learning',
  };
  if (sslMode === 'verify-ca') {
    const certificateAuthority = environment.DB_SSL_CA;
    if (!certificateAuthority?.trim()) {
      throw new Error('DB_SSL_CA must be a non-blank string when DB_SSL_MODE is verify-ca');
    }
    return {
      ...config,
      ssl: {
        ca: certificateAuthority,
        rejectUnauthorized: true,
      },
    };
  }
  return config;
}

function buildClient(): Client {
  return new Client(buildClientConfig(process.env));
}

function discoverMigrations(): MigrationFile[] {
  const files = readdirSync(MIGRATIONS_DIR);
  const ups = files.filter((f) => f.endsWith('.up.sql'));
  const migrations: MigrationFile[] = ups.map((up) => {
    const name = up.replace(/\.up\.sql$/, '');
    const version = name.split('_')[0];
    const down = `${name}.down.sql`;
    if (!files.includes(down)) {
      throw new Error(`Thiếu file down cho migration "${name}": ${down}`);
    }
    return {
      version,
      name,
      upPath: join(MIGRATIONS_DIR, up),
      downPath: join(MIGRATIONS_DIR, down),
    };
  });
  // Sắp xếp theo version (timestamp) tăng dần — thứ tự áp dụng
  migrations.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  return migrations;
}

async function ensureTrackingTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "schema_migrations" (
      "version"     varchar(40) PRIMARY KEY,
      "name"        varchar(200) NOT NULL,
      "applied_at"  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client: Client): Promise<Set<string>> {
  const res = await client.query<{ version: string }>(
    `SELECT "version" FROM "schema_migrations"`,
  );
  return new Set(res.rows.map((r: { version: string }) => r.version));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withLock<T>(
  client: MigrationLockClient,
  fn: () => Promise<T>,
  options: MigrationLockOptions = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const deadlineMillis = options.deadlineMillis ?? ADVISORY_LOCK_DEADLINE_MILLIS;
  const pollIntervalMillis = options.pollIntervalMillis ?? ADVISORY_LOCK_POLL_INTERVAL_MILLIS;
  const sleepUntilNextAttempt = options.sleep ?? sleep;
  const deadline = now() + deadlineMillis;
  let acquired = false;

  while (now() < deadline) {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_KEY]);
    acquired = result.rows[0]?.acquired === true;
    if (acquired) {
      break;
    }
    if (now() < deadline) {
      await sleepUntilNextAttempt(pollIntervalMillis);
    }
  }

  if (!acquired) {
    throw new Error('Migration advisory lock could not be acquired before the lock deadline.');
  }

  let migrationFailure: unknown;
  try {
    return await fn();
  } catch (error) {
    migrationFailure = error;
    throw error;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } catch (unlockError) {
      if (!migrationFailure) {
        throw unlockError;
      }
    }
  }
}

export async function closeClient(client: MigrationClientCleanup): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.end(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Migration database cleanup timed out.')),
          CLEANUP_TIMEOUT_MILLIS,
        );
      }),
    ]);
  } catch {
    // node-postgres has no public force-close API. Destroy only after bounded cleanup fails.
    client.connection.stream.destroy();
    throw new Error('Migration database cleanup failed.');
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function closeClientAfterMigration(
  client: MigrationClientCleanup,
  primaryFailure: unknown,
): Promise<void> {
  try {
    await closeClient(client);
  } catch (cleanupError) {
    console.error('[migration] stage=cleanup-failed');
    if (!primaryFailure) {
      throw cleanupError;
    }
  }
}

export async function runWithinMigrationDeadline<T>(
  client: MigrationClientCleanup,
  operation: () => Promise<T>,
  options: MigrationDeadlineOptions = {},
): Promise<T> {
  const deadlineMillis = options.deadlineMillis ?? MIGRATION_OPERATION_DEADLINE_MILLIS;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          console.error('[migration] stage=deadline-exceeded');
          options.onDeadline?.();
          client.connection.stream.destroy();
          reject(new Error('Migration runtime deadline exceeded.'));
        }, deadlineMillis);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runUp(client: Client): Promise<void> {
  await ensureTrackingTable(client);
  const applied = await appliedVersions(client);
  const all = discoverMigrations();
  const pending = all.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log('Không có migration nào cần chạy. DB đã cập nhật.');
    return;
  }

  for (const m of pending) {
    const sql = readFileSync(m.upPath, 'utf8');
    console.log(`Đang áp dụng: ${m.name}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "schema_migrations" ("version", "name") VALUES ($1, $2)`,
        [m.version, m.name],
      );
      await client.query('COMMIT');
      console.log(`  ✓ ${m.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration "${m.name}" thất bại: ${formatErrorMessage(err)}`);
    }
  }
  console.log(`Hoàn tất ${pending.length} migration.`);
}

export async function runDown(client: Client): Promise<void> {
  await ensureTrackingTable(client);
  const res = await client.query<{ version: string; name: string }>(
    `SELECT "version", "name" FROM "schema_migrations" ORDER BY "version" DESC LIMIT 1`,
  );
  if (res.rows.length === 0) {
    console.log('Không có migration nào để revert.');
    return;
  }
  const last = res.rows[0];
  const all = discoverMigrations();
  const target = all.find((m) => m.version === last.version);
  if (!target) {
    throw new Error(`Không tìm thấy file cho migration đã áp dụng: ${last.name}`);
  }

  const sql = readFileSync(target.downPath, 'utf8');
  console.log(`Đang revert: ${target.name}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(`DELETE FROM "schema_migrations" WHERE "version" = $1`, [
      target.version,
    ]);
    await client.query('COMMIT');
    console.log(`  ✓ reverted ${target.name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Revert "${target.name}" thất bại: ${formatErrorMessage(err)}`);
  }
}

async function runStatus(client: Client): Promise<void> {
  await ensureTrackingTable(client);
  const applied = await appliedVersions(client);
  const all = discoverMigrations();
  console.log('Trạng thái migration:');
  for (const m of all) {
    console.log(`  [${applied.has(m.version) ? 'x' : ' '}] ${m.name}`);
  }
}

async function runMigration(client: Client & MigrationRuntimeClient, cmd: string): Promise<void> {
  console.info('[migration] stage=connect');
  await client.connect();
  console.info('[migration] stage=lock');
  await withLock(client, async () => {
    console.info('[migration] stage=run');
    if (cmd === 'up') await runUp(client);
    else if (cmd === 'down') await runDown(client);
    else if (cmd === 'status') await runStatus(client);
    else throw new Error(`Lệnh không hợp lệ: ${cmd} (dùng up|down|status)`);
  });
}

async function runMigrationCommand(command: string): Promise<void> {
  const client = buildClient();
  let migrationFailure: unknown;
  try {
    await runWithinMigrationDeadline(client, () => runMigration(client, command));
  } catch (error) {
    migrationFailure = error;
    throw error;
  } finally {
    console.info('[migration] stage=cleanup');
    await closeClientAfterMigration(client, migrationFailure);
    if (!migrationFailure) {
      console.info('[migration] stage=complete');
    }
  }
}

export async function runStartupMigrations(): Promise<void> {
  await runMigrationCommand('up');
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';
  if (command === 'up') {
    await runStartupMigrations();
    return;
  }
  await runMigrationCommand(command);
}

// Chỉ chạy CLI khi gọi trực tiếp (node/ts-node migrate.ts), KHÔNG khi bị import (test).
if (require.main === module) {
  main().catch(() => {
    console.error('[migration] stage=failed');
    process.exit(1);
  });
}
