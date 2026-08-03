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
const LOCK_TIMEOUT = '30s';
const STATEMENT_TIMEOUT = '480s';
const STARTUP_OPTIONS = `-c timezone=UTC -c lock_timeout=${LOCK_TIMEOUT} -c statement_timeout=${STATEMENT_TIMEOUT}`;

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
}

export interface MigrationLockClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
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
  const config: ClientConfig = {
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MILLIS,
    database: environment.DB_NAME ?? 'learning',
    host: environment.DB_HOST ?? 'localhost',
    options: STARTUP_OPTIONS,
    password: environment.DB_PASSWORD ?? 'learning',
    port: parsePort(environment.DB_PORT ?? '5432'),
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

export async function withLock<T>(client: MigrationLockClient, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
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

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  const client = buildClient();
  await client.connect();
  try {
    await withLock(client, async () => {
      if (cmd === 'up') await runUp(client);
      else if (cmd === 'down') await runDown(client);
      else if (cmd === 'status') await runStatus(client);
      else throw new Error(`Lệnh không hợp lệ: ${cmd} (dùng up|down|status)`);
    });
  } finally {
    await client.end();
  }
}

// Chỉ chạy CLI khi gọi trực tiếp (node/ts-node migrate.ts), KHÔNG khi bị import (test).
if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
