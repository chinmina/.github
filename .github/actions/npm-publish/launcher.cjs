#!/usr/bin/env node
'use strict';

// Generic, data-driven launcher shipped inside the main npm package.
//
// It holds NO hard-coded platform names and NO `.exe` special-casing. All
// platform knowledge lives in this package's own package.json under
// `chinmina.platforms`, written by the npm-publish action at release time:
//
//   "chinmina": { "platforms": {
//     "linux-x64":  { "package": "@scope/tool-linux-x64",  "bin": "tool" },
//     "win32-x64":  { "package": "@scope/tool-windows-x64", "bin": "tool.exe" }
//   } }
//
// The map key is `${process.platform}-${process.arch}`. This file is a `.cjs`
// so `require` works regardless of the package's "type" field.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Own package.json sits alongside this launcher at the package root.
const ownPkg = require('./package.json');
const commandName = Object.keys(ownPkg.bin || {})[0] || ownPkg.name || 'launcher';

const platforms = (ownPkg.chinmina && ownPkg.chinmina.platforms) || {};
const key = `${process.platform}-${process.arch}`;
const entry = platforms[key];

if (!entry) {
  const supported = Object.keys(platforms).sort().join(', ') || '(none)';
  console.error(
    `${commandName}: unsupported platform ${key}. Supported platforms: ${supported}`,
  );
  process.exit(1);
}

let platformPkgJson;
try {
  platformPkgJson = require.resolve(`${entry.package}/package.json`);
} catch (_err) {
  console.error(
    `${commandName}: platform package ${entry.package} is not installed. ` +
      `Reinstall ${ownPkg.name} to fetch the correct optional dependency.`,
  );
  process.exit(1);
}

const binaryPath = path.join(path.dirname(platformPkgJson), entry.bin);

try {
  execFileSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
} catch (err) {
  if (typeof err.status === 'number') {
    process.exit(err.status);
  }
  if (err.signal) {
    console.error(`${commandName}: ${entry.bin} terminated by signal ${err.signal}`);
    process.exit(1);
  }
  console.error(`${commandName}: failed to run ${entry.bin}: ${err.message}`);
  process.exit(1);
}
