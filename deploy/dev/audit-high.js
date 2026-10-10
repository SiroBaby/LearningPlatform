#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

// GHSA-vfj7-8cjw-p6xm has no patched braces release yet. Only the lint-only path
// pinned by @next/eslint-plugin-next is accepted, and only while braces is absent
// from the production tree (`npm ls --omit=dev`); remove once a fix is published.
const UNPATCHED_BRACES_VERSIONS = new Set(['3.0.3']);
const UNPATCHED_BRACES_ADVISORY = Object.freeze({
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  range: '<=3.0.3',
});
const UNPATCHED_BRACES_PATH = 'eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces';

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

function isAcceptedUnpatchedBraces(vulnerability, installedVersions, installedPaths, productionTree) {
  if (vulnerability.name !== 'braces' || installedVersions.size === 0) return false;
  const advisories = vulnerability.via.filter((entry) => typeof entry === 'object');
  return advisories.length > 0
    && vulnerability.via.length === advisories.length
    && advisories.every((entry) => entry.url === UNPATCHED_BRACES_ADVISORY.url
      && entry.range === UNPATCHED_BRACES_ADVISORY.range)
    && [...installedVersions].every((version) => UNPATCHED_BRACES_VERSIONS.has(version))
    && [...installedPaths].every((path) => path === UNPATCHED_BRACES_PATH)
    && isAbsentFromProductionTree(productionTree, 'braces');
}

function unresolvedVulnerabilities(audit, dependencyTree, productionBracesTree) {
  const vulnerabilities = audit.vulnerabilities ?? {};
  const installedBracesVersions = collectDependencyVersions(dependencyTree, 'braces');
  const installedBracesPaths = collectDependencyPaths(dependencyTree, 'braces');
  const ignored = new Set();

  const isIgnored = (name, visiting = new Set()) => {
    if (ignored.has(name)) return true;
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability) return false;
    if (isAcceptedUnpatchedBraces(vulnerability, installedBracesVersions, installedBracesPaths, productionBracesTree)) {
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

// Fixture runs must pass the production tree explicitly; without it the braces
// exception is never applied.
function loadProductionBracesTree() {
  if (process.argv[4]) return JSON.parse(readFileSync(process.argv[4], 'utf8'));
  if (process.argv[2]) return null;
  return commandJson('npm', ['ls', 'braces', '--all', '--omit=dev', '--json']);
}

function main() {
  const audit = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : commandJson('npm', ['audit', '--json', '--audit-level=high']);
  const dependencyTree = process.argv[3]
    ? JSON.parse(readFileSync(process.argv[3], 'utf8'))
    : commandJson('npm', ['ls', 'braces', '--all', '--json']);
  const productionBracesTree = loadProductionBracesTree();
  const unresolved = unresolvedVulnerabilities(audit, dependencyTree, productionBracesTree);
  if (unresolved.length > 0) {
    console.error(`Unresolved npm audit findings: ${unresolved.join(', ')}`);
    process.exit(1);
  }
  console.log('npm high-severity audit passed');
}

main();
