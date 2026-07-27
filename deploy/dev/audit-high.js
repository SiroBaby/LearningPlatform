#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const PATCHED_BRACE_EXPANSION_VERSIONS = new Set(['1.1.16', '2.1.2', '5.0.8']);
const PATCHED_BRACE_EXPANSION_ADVISORY = 'https://github.com/advisories/GHSA-mh99-v99m-4gvg';

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

function isPatchedBraceExpansion(vulnerability, installedVersions) {
  if (vulnerability.name !== 'brace-expansion' || installedVersions.size === 0) return false;
  const advisories = vulnerability.via.filter((entry) => typeof entry === 'object');
  return advisories.length > 0
    && advisories.every((entry) => entry.url === PATCHED_BRACE_EXPANSION_ADVISORY)
    && [...installedVersions].every((version) => PATCHED_BRACE_EXPANSION_VERSIONS.has(version));
}

function unresolvedVulnerabilities(audit, dependencyTree) {
  const vulnerabilities = audit.vulnerabilities ?? {};
  const installedVersions = collectDependencyVersions(dependencyTree, 'brace-expansion');
  const ignored = new Set();

  const isIgnored = (name, visiting = new Set()) => {
    if (ignored.has(name)) return true;
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability) return false;
    if (isPatchedBraceExpansion(vulnerability, installedVersions)) {
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

function main() {
  const audit = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], 'utf8'))
    : commandJson('npm', ['audit', '--json', '--audit-level=high']);
  const dependencyTree = process.argv[3]
    ? JSON.parse(readFileSync(process.argv[3], 'utf8'))
    : commandJson('npm', ['ls', 'brace-expansion', '--all', '--json']);
  const unresolved = unresolvedVulnerabilities(audit, dependencyTree);
  if (unresolved.length > 0) {
    console.error(`Unresolved npm audit findings: ${unresolved.join(', ')}`);
    process.exit(1);
  }
  console.log('npm high-severity audit passed');
}

main();
