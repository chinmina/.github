'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin');
const FIXTURES = path.join(__dirname, 'fixtures');
const fx = (name) => path.join(FIXTURES, name);

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(BIN, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// --- preflight (Phase 4) ----------------------------------------------------

test('preflight passes for valid consumer + windows archives', () => {
  const res = run('preflight.js', [fx('consumer-minimal.json'), fx('artifacts-windows.json')]);
  assert.equal(res.status, 0, res.stderr);
});

test('preflight fails on missing name and names the input', () => {
  const res = run('preflight.js', [fx('consumer-noname.json'), fx('artifacts-windows.json')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /name/);
});

test('preflight fails on missing consumer file', () => {
  const res = run('preflight.js', [fx('does-not-exist.json'), fx('artifacts-windows.json')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not found/);
});

test('preflight fails on empty archive set', () => {
  const res = run('preflight.js', [fx('consumer-minimal.json'), fx('artifacts-empty.json')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no qualifying/);
});

test('preflight fails on unknown goos before publish', () => {
  const res = run('preflight.js', [fx('consumer-minimal.json'), fx('artifacts-unknown.json')]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown goos/);
});

// --- list-archives (Phase 1) ------------------------------------------------

test('list-archives emits mapped TSV rows for windows fixture', () => {
  const res = run('list-archives.js', [fx('artifacts-windows.json')], {
    PACKAGE_NAME: '@jamestelfer/tool',
  });
  assert.equal(res.status, 0, res.stderr);
  const rows = res.stdout.trim().split('\n').map((l) => l.split('\t'));
  assert.equal(rows.length, 4);
  const win = rows.find((r) => r[3] === '@jamestelfer/tool-windows-x64');
  assert.ok(win, 'windows-x64 row present');
  // columns: path, format, binary, pkgName, os, cpu
  assert.deepEqual(win.slice(3), ['@jamestelfer/tool-windows-x64', 'win32', 'x64']);
  assert.equal(win[1], 'zip');
  assert.equal(win[2], 'tool.exe');
});

test('list-archives fails on unknown goarch/goos', () => {
  const res = run('list-archives.js', [fx('artifacts-unknown.json')], {
    PACKAGE_NAME: '@jamestelfer/tool',
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unknown goos/);
});

// --- platform-package (Phase 1) ---------------------------------------------

test('platform-package emits windows package with win32 os field', () => {
  const res = run('platform-package.js', [], {
    PKG_NAME: '@jamestelfer/tool-windows-x64',
    VERSION: '1.2.3',
    OS: 'win32',
    CPU: 'x64',
    BINARY: 'tool.exe',
    REPO_URL: 'https://github.com/jamestelfer/tool',
  });
  assert.equal(res.status, 0, res.stderr);
  const pkg = JSON.parse(res.stdout);
  assert.equal(pkg.name, '@jamestelfer/tool-windows-x64');
  assert.deepEqual(pkg.os, ['win32']);
  assert.deepEqual(pkg.cpu, ['x64']);
  assert.deepEqual(pkg.files, ['tool.exe']);
});

// --- main-package (Phase 3) -------------------------------------------------

test('main-package emits derived package.json with chinmina map', () => {
  const res = run(
    'main-package.js',
    [fx('consumer-minimal.json'), fx('artifacts-windows.json')],
    {
      PACKAGE_NAME: '@jamestelfer/tool',
      VERSION: '3.1.0',
      REPO_URL: 'https://github.com/jamestelfer/tool',
    },
  );
  assert.equal(res.status, 0, res.stderr);
  const pkg = JSON.parse(res.stdout);
  assert.equal(pkg.version, '3.1.0');
  assert.deepEqual(pkg.bin, { tool: './launcher.cjs' });
  assert.equal(pkg.optionalDependencies['@jamestelfer/tool-windows-x64'], '3.1.0');
  assert.deepEqual(pkg.chinmina.platforms['win32-x64'], {
    package: '@jamestelfer/tool-windows-x64',
    bin: 'tool.exe',
  });
});
