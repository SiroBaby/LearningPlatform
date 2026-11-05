#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

// Advisories with no patched release yet. Each entry accepts only the exact advisory
// URL and range, the exact installed versions, and the exact dev-only dependency paths,
// and only while the package is absent from the production tree (`npm ls --omit=dev`).
// Any other advisory, version or path fails closed. Remove an entry once a fix is published.
const ACCEPTED_UNPATCHED_ADVISORIES = Object.freeze([
  {
    // GHSA-vfj7-8cjw-p6xm: no patched braces release; lint-only path pinned by @next/eslint-plugin-next.
    name: 'braces',
    url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    range: '<=3.0.3',
    versions: new Set(['3.0.3']),
    paths: new Set(['eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces']),
  },
  {
    // GHSA-gcqx-w48m-w2h4: deepmerge 4.3.1 is the latest release and is affected; reachable
    // only through the Nest CLI type-check plugin and jest-config (dev tooling).
    name: 'deepmerge',
    url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4',
    range: '>=4.2.0 <=4.3.1',
    versions: new Set(['4.3.1']),
    paths: new Set([
      '@nestjs/cli>fork-ts-checker-webpack-plugin>deepmerge',
      'jest>@jest/core>jest-config>deepmerge',
    ]),
  },
]);
const ACCEPTED_PACKAGE_NAMES = ACCEPTED_UNPATCHED_ADVISORIES.map((entry) => entry.name);

function commandJson(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (!result.stdout.trim()) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

function collectDependencyVersions(node, dependencyName, versions = new Set()) {
  if (node.name === dependencyName && typeof node.version === 'string') {
    versions.add(node.version);
  }
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    collectDependencyVersions({ name, ...dependency }, dependencyName, versions);
  }
  return versions;
}

function collectDependencyPaths(node, dependencyName, ancestors = [], paths = new Set()) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    const path = [...ancestors, name];
    if (name === dependencyName) paths.add(path.join('>'));
    collectDependencyPaths(dependency, dependencyName, path, paths);
  }
  return paths;
}

// `npm ls` prints a deduped node without its subtree, so the full tree cannot prove
// braces stays off runtime paths. The production tree omits dev nodes entirely.
function isAbsentFromProductionTree(productionTree, dependencyName) {
  return productionTree !== null
    && typeof productionTree === 'object'
    && productionTree.error === undefined
    && productionTree.problems === undefined
    && collectDependencyPaths(productionTree, dependencyName).size === 0;
}

function isAcceptedUnpatched(accepted, vulnerability, dependencyTree, productionTree) {
  if (vulnerability.name !== accepted.name) return false;
  const installedVersions = collectDependencyVersions(dependencyTree, accepted.name);
  const installedPaths = collectDependencyPaths(dependencyTree, accepted.name);
  if (installedVersions.size === 0) return false;
  const advisories = vulnerability.via.filter((entry) => typeof entry === 'object');
  return advisories.length > 0
    && vulnerability.via.length === advisories.length
    && advisories.every((entry) => entry.url === accepted.url && entry.range === accepted.range)
    && [...installedVersions].every((version) => accepted.versions.has(version))
    && [...installedPaths].every((path) => accepted.paths.has(path))
    && isAbsentFromProductionTree(productionTree, accepted.name);
}

function unresolvedVulnerabilities(audit, dependencyTree, productionTree) {
  const vulnerabilities = audit.vulnerabilities ?? {};
  const ignored = new Set();

  const isIgnored = (name, visiting = new Set()) => {
    if (ignored.has(name)) return true;
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability) return false;
    if (ACCEPTED_UNPATCHED_ADVISORIES.some((accepted) => isAcceptedUnpatched(accepted, vulnerability, dependencyTree, productionTree))) {
      ignored.add(name);
      return true;
    }
    if (vulnerability.via.length === 0 || vulnerability.via.some((entry) => typeof entry !== 'string')) {
      return false;
    }
    const nextVisiting = new Set(visiting).add(name);
    if (vulnerability.via.every((dependency) => isIgnored(dependency, nextVisiting))) {
      ignored.add(name);
      return true;
    }
    return false;
  };

  return Object.keys(vulnerabilities).filter((name) => !isIgnored(name));
}

// Fixture runs must pass the production tree explicitly; without it no accepted
// exception is applied.
function loadProductionTree() {
  if (process.argv[4]) return JSON.parse(readFileSync(process.argv[4], 'utf8'));
  if (process.argv[2]) return null;
  return commandJson('npm', ['ls', ...ACCEPTED_PACKAGE_NAMES, '--all', '--omit=dev', '--json']);
}

function main() {
  const audit = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : commandJson('npm', ['audit', '--json', '--audit-level=high']);
  const dependencyTree = process.argv[3]
    ? JSON.parse(readFileSync(process.argv[3], 'utf8'))
    : commandJson('npm', ['ls', ...ACCEPTED_PACKAGE_NAMES, '--all', '--json']);
  const productionTree = loadProductionTree();
  const unresolved = unresolvedVulnerabilities(audit, dependencyTree, productionTree);
  if (unresolved.length > 0) {
    console.error(`Unresolved npm audit findings: ${unresolved.join(', ')}`);
    process.exit(1);
  }
  console.log('npm high-severity audit passed');
}

main();
