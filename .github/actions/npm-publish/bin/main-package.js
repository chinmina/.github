#!/usr/bin/env node
'use strict';

// Emit the fully-derived main package.json to stdout.
//
// Usage: main-package.js <consumer-package.json> <artifacts.json>
// Env:
//   PACKAGE_NAME  base package name (also platform-package base)
//   VERSION       release version (no leading v)
//   REPO_URL      repository url
//   LAUNCHER      launcher filename copied into the package (default launcher.cjs)

const fs = require('node:fs');
const { discoverArchives, mainPackage } = require('../lib/npm-publish');

function fail(message) {
  console.error(`::error title=npm-publish::${message}`);
  process.exit(1);
}

function main() {
  const [pkgPath, artifactsPath] = process.argv.slice(2);
  if (!pkgPath || !artifactsPath) {
    fail('main-package requires <consumer-package.json> <artifacts.json>');
  }
  const base = process.env.PACKAGE_NAME;
  const version = process.env.VERSION;
  const repoUrl = process.env.REPO_URL;
  const launcher = process.env.LAUNCHER;
  if (!base || !version || !repoUrl) {
    fail('PACKAGE_NAME, VERSION and REPO_URL env vars are required');
  }

  let consumer;
  let entries;
  try {
    consumer = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    entries = discoverArchives(JSON.parse(fs.readFileSync(artifactsPath, 'utf8')));
  } catch (err) {
    fail(err.message);
  }

  const derived = mainPackage(consumer, {
    entries,
    version,
    repoUrl,
    base,
    launcher,
  });

  process.stdout.write(JSON.stringify(derived, null, 2) + '\n');
}

main();
