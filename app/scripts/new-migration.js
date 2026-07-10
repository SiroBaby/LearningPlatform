#!/usr/bin/env node
/**
 * Sinh cặp file migration SQL THUẦN với timestamp = Date.now()
 * (luôn tăng, tránh migration mới có timestamp quá khứ so với migration cũ).
 *
 * Dùng:
 *   node scripts/new-migration.js create_processing_jobs
 *   npm run migration:new -- create_processing_jobs
 *
 * Tạo: <timestamp>_<name>.up.sql  và  <timestamp>_<name>.down.sql
 */
'use strict';

const fs = require('fs');
const path = require('path');

const rawName = process.argv[2];
if (!rawName) {
  console.error('Lỗi: thiếu tên migration.\n  Ví dụ: node scripts/new-migration.js create_processing_jobs');
  process.exit(1);
}

// snake_case chữ/số (an toàn cho tên file)
if (!/^[a-z][a-z0-9_]*$/.test(rawName)) {
  console.error(`Lỗi: tên "${rawName}" không hợp lệ. Dùng snake_case (vd create_processing_jobs).`);
  process.exit(1);
}

const timestamp = Date.now();
const base = `${timestamp}_${rawName}`;
const migrationsDir = path.resolve(__dirname, '..', 'src', 'database', 'migrations');

if (!fs.existsSync(migrationsDir)) {
  fs.mkdirSync(migrationsDir, { recursive: true });
}

const upPath = path.join(migrationsDir, `${base}.up.sql`);
const downPath = path.join(migrationsDir, `${base}.down.sql`);

for (const p of [upPath, downPath]) {
  if (fs.existsSync(p)) {
    console.error(`Lỗi: file đã tồn tại: ${p}`);
    process.exit(1);
  }
}

const upTemplate = `-- Migration: ${base} (up)
-- Pure SQL. Dùng IF NOT EXISTS để chạy lại an toàn (idempotent).

-- CREATE TABLE IF NOT EXISTS "example" (
--   "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
-- );
`;

const downTemplate = `-- Migration: ${base} (down)
-- Pure SQL. Dùng IF EXISTS.

-- DROP TABLE IF EXISTS "example";
`;

fs.writeFileSync(upPath, upTemplate, 'utf8');
fs.writeFileSync(downPath, downTemplate, 'utf8');
console.log(`Đã tạo migration:`);
console.log(`  src/database/migrations/${base}.up.sql`);
console.log(`  src/database/migrations/${base}.down.sql`);
