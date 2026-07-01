#!/usr/bin/env node
'use strict';

// Emit one TSV line per platform archive for the action's shell loop to
// extract and publish. All goreleaser->npm mapping happens here so the shell
// contains no platform logic.
//
// Usage: list-archives.js <artifacts.json>
// Env:   PACKAGE_NAME  (base name for platform packages)
// Output columns (tab-separated):
//   path  format  binary  pkgName  os  cpu

const fs = require('node:fs');
const {
  discoverArchives,
  platformPackageName,
  nodeOs,
  npmCpu,
} = require('../lib/npm-publish');

function fail(message) {
  console.error(`::error title=npm-publish::${message}`);
  process.exit(1);
}

function main() {
  const [artifactsPath] = process.argv.slice(2);
  const base = process.env.PACKAGE_NAME;
  if (!artifactsPath) {
    fail('list-archives requires <artifacts.json>');
  }
  if (!base) {
    fail('PACKAGE_NAME env var is required');
  }

  let artifacts;
  try {
    artifacts = JSON.parse(fs.readFileSync(artifactsPath, 'utf8'));
  } catch (err) {
    fail(`could not read artifacts.json at ${artifactsPath}: ${err.message}`);
  }

  let entries;
  try {
    entries = discoverArchives(artifacts);
  } catch (err) {
    fail(err.message);
  }

  const lines = entries.map((entry) => {
    let os;
    let cpu;
    try {
      os = nodeOs(entry.goos);
      cpu = npmCpu(entry.goarch);
    } catch (err) {
      fail(`${err.message} (archive ${entry.path})`);
    }
    const pkgName = platformPackageName(base, entry.goos, entry.goarch);
    return [entry.path, entry.format, entry.binary, pkgName, os, cpu].join('\t');
  });

  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
}

main();
