import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

type PackageLock = {
  readonly packages?: Record<string, unknown>;
};

const FORBIDDEN_PRODUCTION_PACKAGES = new Set(['minio', 'stream-json']);
const appRoot = resolve(__dirname, '..');

function findForbiddenPackagePaths(packagePaths: readonly string[]): string[] {
  return packagePaths.filter((packagePath) => {
    const packageNames = [...packagePath.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)]
      .map((match) => match[1]);
    return packageNames.some((packageName) => FORBIDDEN_PRODUCTION_PACKAGES.has(packageName));
  });
}

describe('production dependency graph', () => {
  it('does not retain the vulnerable MinIO stream-json dependency path', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(appRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const packageLock = JSON.parse(
      readFileSync(resolve(appRoot, 'package-lock.json'), 'utf8'),
    ) as PackageLock;

    expect(packageJson.dependencies).not.toHaveProperty('minio');
    expect(findForbiddenPackagePaths(Object.keys(packageLock.packages ?? {}))).toEqual([]);
  });

  it('detects forbidden packages at nested node_modules paths', () => {
    expect(findForbiddenPackagePaths([
      'node_modules/parent/node_modules/minio',
      'node_modules/parent/node_modules/child/node_modules/stream-json',
    ])).toEqual([
      'node_modules/parent/node_modules/minio',
      'node_modules/parent/node_modules/child/node_modules/stream-json',
    ]);
  });
});
