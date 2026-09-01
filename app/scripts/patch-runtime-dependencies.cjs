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
const decoderModulePath = require.resolve('decode-uri-component', {
  paths: [path.dirname(queryStringPath)],
});
const decoderPackagePath = path.join(path.dirname(decoderModulePath), 'package.json');
const decoderPackage = JSON.parse(fs.readFileSync(decoderPackagePath, 'utf8'));
if (decoderPackage.version !== '0.5.0') {
  throw new Error(`Unsupported decode-uri-component version: ${decoderPackage.version}`);
}

// query-string is CommonJS, while the patched decoder is ESM. Generate a local
// CJS bridge so Jest and Node 22 can load the dependency synchronously.
const decoderCjsPath = path.join(path.dirname(decoderModulePath), 'index.cjs');
const decoderSource = fs.readFileSync(decoderModulePath, 'utf8');
const decoderExport = 'export default function decodeUriComponent';
if (!decoderSource.includes(decoderExport)) {
  throw new Error('decode-uri-component export contract is missing');
}

const decoderCjsSource = `${decoderSource.replace(decoderExport, 'function decodeUriComponent')}\nmodule.exports = decodeUriComponent;\n`;
if (!fs.existsSync(decoderCjsPath) || fs.readFileSync(decoderCjsPath, 'utf8') !== decoderCjsSource) {
  fs.writeFileSync(decoderCjsPath, decoderCjsSource);
}

const decoderImportPath = path.relative(path.dirname(queryStringPath), decoderCjsPath).replaceAll(path.sep, '/');
const relativeDecoderImportPath = decoderImportPath.startsWith('.') ? decoderImportPath : `./${decoderImportPath}`;
const legacyImport = "const decodeComponent = require('decode-uri-component');";
const previousCompatibleImport = [
  "const decodeComponentModule = require('decode-uri-component');",
  "const decodeComponent = typeof decodeComponentModule === 'function'",
  "\t? decodeComponentModule",
  "\t: decodeComponentModule.default;",
].join('\n');
const compatibleImport = `const decodeComponent = require(${JSON.stringify(relativeDecoderImportPath)});`;

if (!source.includes(compatibleImport)) {
  if (source.includes(legacyImport)) {
    fs.writeFileSync(queryStringPath, source.replace(legacyImport, compatibleImport));
  } else if (source.includes(previousCompatibleImport)) {
    fs.writeFileSync(queryStringPath, source.replace(previousCompatibleImport, compatibleImport));
  } else {
    throw new Error('query-string decoder import contract is missing');
  }
}

const queryString = require(queryStringPath);
if (typeof require(decoderCjsPath) !== 'function') {
  throw new Error('decode-uri-component CJS bridge contract failed');
}
const sample = { 'a b': 'c/d' };
const parsed = queryString.parse(queryString.stringify(sample));
if (parsed['a b'] !== sample['a b']) {
  throw new Error('query-string parse/stringify runtime contract failed');
}
