import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

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

interface MigrationFile {
  version: string; // timestamp prefix
  name: string; // <timestamp>_<name>
  upPath: string;
  downPath: string;
}

function buildClient(): Client {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'learning',
    password: process.env.DB_PASSWORD ?? 'learning',
    database: process.env.DB_NAME ?? 'learning',
  });
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

async function withLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
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
      throw new Error(`Migration "${m.name}" thất bại: ${(err as Error).message}`);
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
    throw new Error(`Revert "${target.name}" thất bại: ${(err as Error).message}`);
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
