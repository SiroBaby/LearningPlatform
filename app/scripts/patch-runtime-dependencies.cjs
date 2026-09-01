'use strict';

const fs = require('node:fs');
const path = require('node:path');

const queryStringPackagePath = require.resolve('query-string/package.json');
const queryStringPackage = JSON.parse(fs.readFileSync(queryStringPackagePath, 'utf8'));
if (queryStringPackage.version !== '7.1.3') {
  throw new Error(`Unsupported query-string version: ${queryStringPackage.version}`);
}

const queryStringPath = path.join(path.dirname(queryStringPackagePath), 'index.js');
const source = fs.readFileSync(queryStringPath, 'utf8');
const legacyImport = "const decodeComponent = require('decode-uri-component');";
const compatibleImport = [
  "const decodeComponentModule = require('decode-uri-component');",
  "const decodeComponent = typeof decodeComponentModule === 'function'",
  "\t? decodeComponentModule",
  "\t: decodeComponentModule.default;",
].join('\n');

if (!source.includes(compatibleImport)) {
  if (!source.includes(legacyImport)) {
    throw new Error('query-string decoder import contract is missing');
  }

  fs.writeFileSync(queryStringPath, source.replace(legacyImport, compatibleImport));
}

const queryString = require(queryStringPath);
const sample = { 'a b': 'c/d' };
const parsed = queryString.parse(queryString.stringify(sample));
if (parsed['a b'] !== sample['a b']) {
  throw new Error('query-string parse/stringify runtime contract failed');
}
