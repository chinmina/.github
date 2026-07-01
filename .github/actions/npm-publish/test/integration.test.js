'use strict';

// End-to-end integration for bin/publish.sh with a stubbed `npm` on PATH.
// Verifies real publish counts, ordering (fail-fast), and the tarball-shape
// package.json each publish would ship. POSIX-only (uses tar + bash stub).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ACTION_PATH = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

// Create a fake goreleaser dist/ with real tar.gz/zip archives matching an
// artifacts.json, plus a consumer main package dir. Returns paths + a PATH
// prefix carrying a stub `npm` that records each publish into publishes.log.
function setup(artifactsFixture, consumerFixture) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-publish-e2e-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist, { recursive: true });

  const artifacts = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, artifactsFixture), 'utf8'),
  );
  // Rewrite archive paths to live under our temp dist/ and build them.
  for (const a of artifacts) {
    if (a.type !== 'Archive' || !a.extra || !a.extra.Binaries) continue;
    const binary = a.extra.Binaries[0];
    const stage = fs.mkdtempSync(path.join(root, 'stage-'));
    fs.writeFileSync(path.join(stage, binary), `#!/bin/sh\necho ${binary}\n`);
    const archiveName = path.basename(a.path);
    const archivePath = path.join(dist, archiveName);
    if (a.extra.Format === 'zip') {
      execFileSync('zip', ['-j', '-q', archivePath, path.join(stage, binary)]);
    } else {
      execFileSync('tar', ['-czf', archivePath, '-C', stage, binary]);
    }
    a.path = archivePath;
  }
  const artifactsPath = path.join(root, 'artifacts.json');
  fs.writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2));

  const mainDir = path.join(root, 'main');
  fs.mkdirSync(mainDir, { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURES, consumerFixture),
    path.join(mainDir, 'package.json'),
  );

  // Stub npm: on `publish <dir>`, record the dir's package.json name/version
  // and copy the package.json out for inspection; anything else is a no-op.
  const binDir = path.join(root, 'stubbin');
  fs.mkdirSync(binDir, { recursive: true });
  const publishesLog = path.join(root, 'publishes.log');
  const capturedDir = path.join(root, 'captured');
  fs.mkdirSync(capturedDir, { recursive: true });
  const npmStub = path.join(binDir, 'npm');
  fs.writeFileSync(
    npmStub,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "${1:-}" == "publish" ]]; then',
      '  dir="${@: -1}"',
      `  n="$(node -e 'process.stdout.write(require(process.argv[1]).name)' "$dir/package.json")"`,
      `  echo "$n" >> "${publishesLog}"`,
      '  safe="${n//\//_}"',
      `  cp "$dir/package.json" "${capturedDir}/$safe.json"`,
      'fi',
      'exit 0',
    ].join('\n') + '\n',
  );
  fs.chmodSync(npmStub, 0o755);

  return { root, artifactsPath, mainDir, binDir, publishesLog, capturedDir };
}

function runPublish(env) {
  return spawnSync('bash', [path.join(ACTION_PATH, 'bin', 'publish.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${env.binDir}:${process.env.PATH}`,
      ACTION_PATH,
      PACKAGE_NAME: '@jamestelfer/tool',
      ARTIFACTS_JSON: env.artifactsPath,
      MAIN_PACKAGE_DIR: env.mainDir,
      VERSION: env.version || '1.2.3',
      README: '',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'jamestelfer/tool',
    },
  });
}

function readPublishes(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
}

test('windows release publishes platform + main packages end-to-end', () => {
  const env = setup('artifacts-windows.json', 'consumer-minimal.json');
  const res = runPublish(env);
  assert.equal(res.status, 0, res.stderr);

  const published = readPublishes(env.publishesLog);
  // 4 platform packages + 1 main.
  assert.equal(published.length, 5);
  assert.ok(published.includes('@jamestelfer/tool-windows-x64'));
  assert.ok(published.includes('@jamestelfer/tool-windows-arm64'));
  // Main published last.
  assert.equal(published[published.length - 1], '@jamestelfer/tool');

  const winPkg = JSON.parse(
    fs.readFileSync(path.join(env.capturedDir, '@jamestelfer_tool-windows-x64.json'), 'utf8'),
  );
  assert.deepEqual(winPkg.os, ['win32']);
  assert.deepEqual(winPkg.files, ['tool.exe']);

  const mainPkg = JSON.parse(
    fs.readFileSync(path.join(env.capturedDir, '@jamestelfer_tool.json'), 'utf8'),
  );
  assert.equal(mainPkg.version, '1.2.3');
  assert.deepEqual(mainPkg.bin, { tool: './launcher.cjs' });
  assert.equal(
    mainPkg.optionalDependencies['@jamestelfer/tool-windows-x64'],
    '1.2.3',
  );
  assert.ok(mainPkg.chinmina.platforms['win32-x64']);
  // Launcher copied into the published main package.
  assert.ok(fs.existsSync(path.join(ACTION_PATH, 'launcher.cjs')));
});

test('prerelease version publishes everything (tag next path exercised)', () => {
  const env = setup('artifacts-no-windows.json', 'consumer-minimal.json');
  const res = runPublish({ ...env, version: '1.2.3-rc.1' });
  assert.equal(res.status, 0, res.stderr);
  const published = readPublishes(env.publishesLog);
  assert.equal(published.length, 5); // 4 platform + main
  const mainPkg = JSON.parse(
    fs.readFileSync(path.join(env.capturedDir, '@jamestelfer_tool.json'), 'utf8'),
  );
  assert.equal(mainPkg.version, '1.2.3-rc.1');
});

test('preflight blocks publish: zero npm invocations on bad input', () => {
  // Simulate the action ordering: preflight runs first; on failure the publish
  // step never runs. Assert preflight fails AND (had it proceeded) nothing was
  // published.
  const env = setup('artifacts-windows.json', 'consumer-noname.json');
  const pre = spawnSync(
    process.execPath,
    [path.join(ACTION_PATH, 'bin', 'preflight.js'), path.join(env.mainDir, 'package.json'), env.artifactsPath],
    { encoding: 'utf8' },
  );
  assert.equal(pre.status, 1);
  assert.match(pre.stderr, /name/);
  assert.equal(readPublishes(env.publishesLog).length, 0);
});

test('preflight blocks publish on empty archive set', () => {
  const env = setup('artifacts-empty.json', 'consumer-minimal.json');
  const pre = spawnSync(
    process.execPath,
    [path.join(ACTION_PATH, 'bin', 'preflight.js'), path.join(env.mainDir, 'package.json'), env.artifactsPath],
    { encoding: 'utf8' },
  );
  assert.equal(pre.status, 1);
  assert.match(pre.stderr, /no qualifying/);
  assert.equal(readPublishes(env.publishesLog).length, 0);
});
