const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const sourceMigrationsDir = join(__dirname, '..', 'src', 'database', 'migrations');
const distMigrationsDir = join(__dirname, '..', 'dist', 'database', 'migrations');

function findSqlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findSqlFiles(path);
    }
    return entry.isFile() && path.endsWith('.sql') ? [path] : [];
  });
}

function assertMigrationAssets() {
  const sourceFiles = findSqlFiles(sourceMigrationsDir).sort();
  if (sourceFiles.length === 0) {
    throw new Error(`No SQL migrations found in ${sourceMigrationsDir}`);
  }

  for (const sourcePath of sourceFiles) {
    const migrationPath = relative(sourceMigrationsDir, sourcePath);
    const distPath = join(distMigrationsDir, migrationPath);
    let distIsFile = false;
    try {
      distIsFile = statSync(distPath).isFile();
    } catch {
      // Report the missing runtime asset using its stable relative path.
    }
    if (!distIsFile) {
      throw new Error(`Missing compiled migration asset: dist/database/migrations/${migrationPath}`);
    }
    if (!readFileSync(sourcePath).equals(readFileSync(distPath))) {
      throw new Error(`Compiled migration asset differs from source: ${migrationPath}`);
    }
  }

  process.stdout.write(`Verified ${sourceFiles.length} migration assets in dist/database/migrations.\n`);
}

assertMigrationAssets();
