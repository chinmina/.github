#!/usr/bin/env node
'use strict';

// Fail-fast preflight: validate all consumer input BEFORE the first
// `npm publish`, so a bad input cannot leave a half-published release.
//
// Usage: preflight.js <consumer-package.json> <artifacts.json>
// Exits non-zero with a GitHub ::error annotation naming the offending input.

const fs = require('node:fs');
const {
  discoverArchives,
  validateConsumer,
  validateArchives,
  nodeOs,
  npmCpu,
} = require('../lib/npm-publish');

function fail(message) {
  console.error(`::error title=npm-publish::${message}`);
  process.exit(1);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_err) {
    fail(`${label} not found at ${file}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${label} at ${file} is not valid JSON: ${err.message}`);
  }
}

function main() {
  const [pkgPath, artifactsPath] = process.argv.slice(2);
  if (!pkgPath || !artifactsPath) {
    fail('preflight requires <consumer-package.json> <artifacts.json>');
  }

  const consumer = readJson(pkgPath, 'main package.json');
  try {
    validateConsumer(consumer);
  } catch (err) {
    fail(err.message);
  }

  const artifacts = readJson(artifactsPath, 'artifacts.json');
  let entries;
  try {
    entries = discoverArchives(artifacts);
    validateArchives(entries);
  } catch (err) {
    fail(err.message);
  }

  // Verify every discovered platform maps to a known Node os/cpu before any
  // publish (R4 fail-fast, rather than mid-loop).
  for (const entry of entries) {
    try {
      nodeOs(entry.goos);
      npmCpu(entry.goarch);
    } catch (err) {
      fail(`${err.message} (archive ${entry.path})`);
    }
  }
}

main();
