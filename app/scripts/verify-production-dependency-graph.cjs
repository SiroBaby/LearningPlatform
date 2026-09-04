#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const forbiddenPackages = new Set(['minio', 'stream-json']);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageNamesFromLockPath(packagePath) {
  return [...packagePath.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)]
    .map((match) => match[1]);
}

function findForbiddenLockPaths(packageLock) {
  return Object.keys(packageLock.packages ?? {}).filter((packagePath) =>
    packageNamesFromLockPath(packagePath).some((packageName) => forbiddenPackages.has(packageName)));
}

function findForbiddenInstalledPackages(node, path = 'root', results = []) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    const dependencyPath = `${path}/node_modules/${name}`;
    if (forbiddenPackages.has(name)) results.push(dependencyPath);
    findForbiddenInstalledPackages(dependency, dependencyPath, results);
  }
  return results;
}

function fail(message) {
  process.stderr.write(`production dependency graph failed: ${message}\n`);
  process.exit(1);
}

const packageJson = readJson(resolve(appRoot, 'package.json'));
const packageLock = readJson(resolve(appRoot, 'package-lock.json'));
const installedGraphPath = process.argv[2];
if (!installedGraphPath) fail('npm ls JSON path is required');
const installedGraph = readJson(installedGraphPath);

if (packageJson.dependencies && Object.keys(packageJson.dependencies).some((name) => forbiddenPackages.has(name))) {
  fail('package.json declares a forbidden production package');
}

const forbiddenLockPaths = findForbiddenLockPaths(packageLock);
if (forbiddenLockPaths.length > 0) fail(`lockfile contains forbidden package paths: ${forbiddenLockPaths.join(', ')}`);

const forbiddenInstalledPackages = findForbiddenInstalledPackages(installedGraph);
if (forbiddenInstalledPackages.length > 0) {
  fail(`npm ls production graph contains forbidden packages: ${forbiddenInstalledPackages.join(', ')}`);
}

process.stdout.write('production dependency graph passed\n');
