#!/usr/bin/env node
'use strict';

// Emit a single platform package's package.json to stdout.
//
// Env:
//   PKG_NAME  full platform package name (e.g. @scope/tool-windows-x64)
//   VERSION   release version (no leading v)
//   OS        Node os field value (linux/darwin/win32)
//   CPU       Node cpu field value (x64/arm64/...)
//   BINARY    binary filename shipped in the archive
//   REPO_URL  repository url

function fail(message) {
  console.error(`::error title=npm-publish::${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    fail(`${name} env var is required`);
  }
  return value;
}

const pkg = {
  name: required('PKG_NAME'),
  version: required('VERSION'),
  os: [required('OS')],
  cpu: [required('CPU')],
  files: [required('BINARY')],
  license: 'MIT',
  repository: { type: 'git', url: required('REPO_URL') },
};

process.stdout.write(JSON.stringify(pkg, null, 2) + '\n');
