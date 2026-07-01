'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('../lib/npm-publish');

const FIXTURES = path.join(__dirname, 'fixtures');
const REPO = 'https://github.com/jamestelfer/tool';
const BASE = '@jamestelfer/tool';

function loadArtifacts(name) {
  return lib.discoverArchives(
    JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')),
  );
}

function loadConsumer(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

// --- Phase 1: naming & field split -----------------------------------------

test('mapping: windows goos maps to win32 os field', () => {
  assert.equal(lib.nodeOs('windows'), 'win32');
  assert.equal(lib.nodeOs('linux'), 'linux');
  assert.equal(lib.nodeOs('darwin'), 'darwin');
});

test('mapping: goarch maps to npm cpu token', () => {
  assert.equal(lib.npmCpu('amd64'), 'x64');
  assert.equal(lib.npmCpu('arm64'), 'arm64');
  assert.equal(lib.npmCpu('386'), 'ia32');
  assert.equal(lib.npmCpu('arm'), 'arm');
});

test('mapping: unknown goos/goarch throws', () => {
  assert.throws(() => lib.nodeOs('plan9'), /unknown goos/);
  assert.throws(() => lib.npmCpu('riscv64'), /unknown goarch/);
});

test('platform package name keeps raw windows goos token', () => {
  assert.equal(
    lib.platformPackageName(BASE, 'windows', 'amd64'),
    '@jamestelfer/tool-windows-x64',
  );
  assert.equal(
    lib.platformPackageName(BASE, 'linux', 'arm64'),
    '@jamestelfer/tool-linux-arm64',
  );
});

test('windows platform package: name uses windows, os field uses win32', () => {
  const entries = loadArtifacts('artifacts-windows.json');
  const winEntry = entries.find((e) => e.goos === 'windows' && e.goarch === 'amd64');
  const pkg = lib.platformPackage(winEntry, {
    base: BASE,
    version: '1.2.3',
    repoUrl: REPO,
  });
  assert.equal(pkg.name, '@jamestelfer/tool-windows-x64');
  assert.deepEqual(pkg.os, ['win32']);
  assert.deepEqual(pkg.cpu, ['x64']);
  assert.deepEqual(pkg.files, ['tool.exe']);
  assert.deepEqual(pkg.repository, { type: 'git', url: REPO });
});

test('discovery excludes source/checksum and no-binary entries', () => {
  const entries = loadArtifacts('artifacts-windows.json');
  assert.equal(entries.length, 4);
  assert.ok(entries.every((e) => e.binary));
});

test('no-windows fixture yields linux/darwin packages equivalent to prior', () => {
  const entries = loadArtifacts('artifacts-no-windows.json');
  const names = entries
    .map((e) => lib.platformPackageName(BASE, e.goos, e.goarch))
    .sort();
  assert.deepEqual(names, [
    '@jamestelfer/tool-darwin-arm64',
    '@jamestelfer/tool-darwin-x64',
    '@jamestelfer/tool-linux-arm64',
    '@jamestelfer/tool-linux-x64',
  ]);
  // os/cpu fields match the legacy pipeline (goos==node os for non-windows).
  for (const e of entries) {
    const pkg = lib.platformPackage(e, { base: BASE, version: '1.0.0', repoUrl: REPO });
    assert.equal(pkg.os[0], e.goos);
  }
});

// --- Phase 2: chinmina.platforms map ----------------------------------------

test('platforms map keys win32-* to windows-named package', () => {
  const entries = loadArtifacts('artifacts-windows.json');
  const map = lib.platformsMap(entries, BASE);
  assert.deepEqual(map['win32-x64'], {
    package: '@jamestelfer/tool-windows-x64',
    bin: 'tool.exe',
  });
  assert.deepEqual(map['win32-arm64'], {
    package: '@jamestelfer/tool-windows-arm64',
    bin: 'tool.exe',
  });
  assert.deepEqual(map['linux-x64'], {
    package: '@jamestelfer/tool-linux-x64',
    bin: 'tool',
  });
  assert.equal(Object.keys(map).length, 4);
});

// --- Phase 3: main package.json derivation ----------------------------------

test('main package: full overrides for version/repository/optionalDeps/bin', () => {
  const consumer = loadConsumer('consumer-with-extras.json');
  const derived = lib.mainPackage(consumer, {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '2.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.equal(derived.version, '2.0.0');
  assert.deepEqual(derived.repository, { type: 'git', url: REPO });
  // optionalDependencies exactly the discovered set, ignoring junk input.
  assert.deepEqual(derived.optionalDependencies, {
    '@jamestelfer/tool-linux-x64': '2.0.0',
    '@jamestelfer/tool-linux-arm64': '2.0.0',
    '@jamestelfer/tool-darwin-x64': '2.0.0',
    '@jamestelfer/tool-darwin-arm64': '2.0.0',
  });
  assert.equal(derived.optionalDependencies.junk, undefined);
});

test('main package: bin defaults to unscoped name -> launcher', () => {
  const derived = lib.mainPackage(loadConsumer('consumer-minimal.json'), {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.deepEqual(derived.bin, { tool: './launcher.cjs' });
});

test('main package: command-name override changes bin key', () => {
  const derived = lib.mainPackage(loadConsumer('consumer-override.json'), {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.deepEqual(derived.bin, { mytool: './launcher.cjs' });
});

test('main package: files union without loss or duplicates', () => {
  const derived = lib.mainPackage(loadConsumer('consumer-with-extras.json'), {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.deepEqual(derived.files, ['launcher.cjs', 'README.md', 'extra.txt']);
});

test('main package: engines set when absent, preserved when present', () => {
  const added = lib.mainPackage(loadConsumer('consumer-minimal.json'), {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.deepEqual(added.engines, { node: '>=18' });

  const preserved = lib.mainPackage(loadConsumer('consumer-with-extras.json'), {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.deepEqual(preserved.engines, { node: '>=20' });
});

test('main package: metadata untouched', () => {
  const consumer = loadConsumer('consumer-minimal.json');
  const derived = lib.mainPackage(consumer, {
    entries: loadArtifacts('artifacts-no-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.equal(derived.name, consumer.name);
  assert.equal(derived.description, consumer.description);
  assert.equal(derived.homepage, consumer.homepage);
  assert.equal(derived.license, consumer.license);
  assert.deepEqual(derived.keywords, consumer.keywords);
});

test('main package: chinmina.platforms present and overrides consumer block', () => {
  const derived = lib.mainPackage(loadConsumer('consumer-override.json'), {
    entries: loadArtifacts('artifacts-windows.json'),
    version: '1.0.0',
    repoUrl: REPO,
    base: BASE,
  });
  assert.ok(derived.chinmina.platforms['win32-x64']);
  assert.equal(derived.chinmina.command, undefined);
});

// --- Phase 4: validation -----------------------------------------------------

test('validateConsumer rejects missing name', () => {
  assert.throws(() => lib.validateConsumer(loadConsumer('consumer-noname.json')), /name/);
  assert.throws(() => lib.validateConsumer(null), /missing/);
});

test('validateArchives rejects empty archive set', () => {
  const entries = loadArtifacts('artifacts-empty.json');
  assert.equal(entries.length, 0);
  assert.throws(() => lib.validateArchives(entries), /no qualifying/);
});
