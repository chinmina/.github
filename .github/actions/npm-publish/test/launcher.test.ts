import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LAUNCHER = join(import.meta.dir, "..", "launcher.cjs");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// Build a throwaway installed-package layout:
//   <root>/package.json           (main package, with chinmina.platforms)
//   <root>/launcher.cjs           (copy of the launcher under test)
//   <root>/node_modules/<pkg>/... (the platform package + stub binary)
// The launcher is executed with Node (its runtime target), not Bun.
function makeFixture(opts: { mapCurrentPlatform?: boolean; exitCode?: number } = {}): string {
  const { mapCurrentPlatform = true, exitCode = 0 } = opts;
  const root = mkdtempSync(join(tmpdir(), "launcher-"));
  roots.push(root);
  const platformPkg = "@fixture/tool-current";
  const binName = "toolbin";

  const pkgDir = join(root, "node_modules", platformPkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: platformPkg, version: "1.0.0" }));
  const binPath = join(pkgDir, binName);
  writeFileSync(binPath, `#!/usr/bin/env bash\necho "ARGS:$*"\nexit ${exitCode}\n`);
  chmodSync(binPath, 0o755);

  const key = `${process.platform}-${process.arch}`;
  const platforms: Record<string, unknown> = {};
  if (mapCurrentPlatform) platforms[key] = { package: platformPkg, bin: binName };
  else platforms["solaris-sparc"] = { package: platformPkg, bin: binName };

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@fixture/tool", version: "1.0.0", bin: { tool: "./launcher.cjs" }, chinmina: { platforms } }),
  );
  copyFileSync(LAUNCHER, join(root, "launcher.cjs"));
  return root;
}

function runLauncher(root: string, args: string[]) {
  return spawnSync("node", [join(root, "launcher.cjs"), ...args], { encoding: "utf8" });
}

test("launcher execs mapped binary and forwards arguments", () => {
  const res = runLauncher(makeFixture(), ["hello", "--flag", "value"]);
  expect(res.status).toBe(0);
  expect(res.stdout).toMatch(/ARGS:hello --flag value/);
});

test("launcher propagates zero exit code", () => {
  expect(runLauncher(makeFixture({ exitCode: 0 }), []).status).toBe(0);
});

test("launcher propagates non-zero exit code", () => {
  expect(runLauncher(makeFixture({ exitCode: 42 }), []).status).toBe(42);
});

test("launcher errors clearly on unmapped platform", () => {
  const res = runLauncher(makeFixture({ mapCurrentPlatform: false }), []);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/unsupported platform/);
});
