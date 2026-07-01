'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LAUNCHER = path.join(__dirname, '..', 'launcher.cjs');

// Build a throwaway installed-package layout:
//   <root>/package.json            (main package, with chinmina.platforms)
//   <root>/launcher.cjs            (copy of the launcher under test)
//   <root>/node_modules/<pkg>/...  (the platform package + stub binary)
// The stub binary echoes its args and exits with a chosen code.
function makeFixture({ mapCurrentPlatform = true, exitCode = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-'));
  const platformPkg = '@fixture/tool-current';
  const binName = 'toolbin';

  // Stub executable: a shell script that prints args then exits exitCode.
  const pkgDir = path.join(root, 'node_modules', platformPkg);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: platformPkg, version: '1.0.0' }),
  );
  const binPath = path.join(pkgDir, binName);
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env bash\necho "ARGS:$*"\nexit ${exitCode}\n`,
  );
  fs.chmodSync(binPath, 0o755);

  const key = `${process.platform}-${process.arch}`;
  const platforms = {};
  if (mapCurrentPlatform) {
    platforms[key] = { package: platformPkg, bin: binName };
  } else {
    platforms['solaris-sparc'] = { package: platformPkg, bin: binName };
  }

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: '@fixture/tool',
      version: '1.0.0',
      bin: { tool: './launcher.cjs' },
      chinmina: { platforms },
    }),
  );
  fs.copyFileSync(LAUNCHER, path.join(root, 'launcher.cjs'));
  return { root };
}

function runLauncher(root, args) {
  return spawnSync(process.execPath, [path.join(root, 'launcher.cjs'), ...args], {
    encoding: 'utf8',
  });
}

test('launcher execs mapped binary and forwards arguments', () => {
  const { root } = makeFixture();
  const res = runLauncher(root, ['hello', '--flag', 'value']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /ARGS:hello --flag value/);
});

test('launcher propagates zero exit code', () => {
  const { root } = makeFixture({ exitCode: 0 });
  assert.equal(runLauncher(root, []).status, 0);
});

test('launcher propagates non-zero exit code', () => {
  const { root } = makeFixture({ exitCode: 42 });
  assert.equal(runLauncher(root, []).status, 42);
});

test('launcher errors clearly on unmapped platform', () => {
  const { root } = makeFixture({ mapCurrentPlatform: false });
  const res = runLauncher(root, []);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /unsupported platform/);
});
