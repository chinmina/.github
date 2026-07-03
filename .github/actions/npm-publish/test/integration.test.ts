import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// End-to-end integration for src/publish.ts with a stubbed `npm` on PATH.
// Verifies real publish counts, ordering (fail-fast), and the tarball-shape
// package.json each publish would ship. POSIX-only (uses tar/zip + a bash stub).

const ACTION_PATH = join(import.meta.dir, "..");
const PUBLISH = join(ACTION_PATH, "src", "publish.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

interface Env {
  root: string;
  artifactsPath: string;
  mainDir: string;
  binDir: string;
  publishesLog: string;
  capturedDir: string;
}

// Build a fake goreleaser dist/ with real archives matching an artifacts.json,
// a consumer main package dir, and a stub `npm` recording each publish.
function setup(artifactsFixture: string, consumer: Record<string, unknown>): Env {
  const root = mkdtempSync(join(tmpdir(), "npm-publish-e2e-"));
  roots.push(root);
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });

  const artifacts = JSON.parse(readFileSync(join(FIXTURES, artifactsFixture), "utf8"));
  for (const a of artifacts) {
    if (a.type !== "Archive" || !a.extra?.Binaries) continue;
    const binary = a.extra.Binaries[0];
    const stage = mkdtempSync(join(root, "stage-"));
    writeFileSync(join(stage, binary), `#!/bin/sh\necho ${binary}\n`);
    const archivePath = join(dist, basename(a.path));
    if (a.extra.Format === "zip") {
      spawnSync("zip", ["-j", "-q", archivePath, join(stage, binary)]);
    } else {
      spawnSync("tar", ["-czf", archivePath, "-C", stage, binary]);
    }
    a.path = archivePath;
  }
  const artifactsPath = join(root, "artifacts.json");
  writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2));

  const mainDir = join(root, "main");
  mkdirSync(mainDir, { recursive: true });
  writeFileSync(join(mainDir, "package.json"), JSON.stringify(consumer, null, 2));

  // Stub npm: on `publish <dir>`, record the package name and copy its
  // package.json out (name sanitised for the filename); else no-op.
  const binDir = join(root, "stubbin");
  mkdirSync(binDir, { recursive: true });
  const publishesLog = join(root, "publishes.log");
  const capturedDir = join(root, "captured");
  mkdirSync(capturedDir, { recursive: true });
  const npmStub = join(binDir, "npm");
  writeFileSync(
    npmStub,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "${1:-}" == "publish" ]]; then',
      '  dir="${@: -1}"',
      `  n="$(node -e 'process.stdout.write(require(process.argv[1]).name)' "$dir/package.json")"`,
      `  echo "$n" >> "${publishesLog}"`,
      '  safe="${n//\\//_}"',
      `  cp "$dir/package.json" "${capturedDir}/$safe.json"`,
      "fi",
      "exit 0",
    ].join("\n") + "\n",
  );
  chmodSync(npmStub, 0o755);

  return { root, artifactsPath, mainDir, binDir, publishesLog, capturedDir };
}

function runPublish(env: Env, version = "1.2.3") {
  return spawnSync("bun", [PUBLISH], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${env.binDir}:${process.env.PATH}`,
      ACTION_PATH,
      PACKAGE_NAME: "@jamestelfer/tool",
      ARTIFACTS_JSON: env.artifactsPath,
      MAIN_PACKAGE_DIR: env.mainDir,
      VERSION: version,
      README: "",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "jamestelfer/tool",
    },
  });
}

function publishes(env: Env): string[] {
  if (!existsSync(env.publishesLog)) return [];
  return readFileSync(env.publishesLog, "utf8").trim().split("\n").filter(Boolean);
}

function captured(env: Env, name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(env.capturedDir, `${name.replace(/\//g, "_")}.json`), "utf8"));
}

const minimalConsumer = { name: "@jamestelfer/tool", description: "tool", license: "MIT" };

test("windows release publishes platform + main packages end-to-end", () => {
  const env = setup("artifacts-windows.json", minimalConsumer);
  const res = runPublish(env);
  expect(res.status).toBe(0);

  const list = publishes(env);
  expect(list).toHaveLength(5); // 4 platform + 1 main
  expect(list).toContain("@jamestelfer/tool-windows-x64");
  expect(list).toContain("@jamestelfer/tool-windows-arm64");
  expect(list.at(-1)).toBe("@jamestelfer/tool"); // main published last

  const win = captured(env, "@jamestelfer/tool-windows-x64");
  expect(win.os).toEqual(["win32"]);
  expect(win.files).toEqual(["tool.exe"]);

  const main = captured(env, "@jamestelfer/tool");
  expect(main.name).toBe("@jamestelfer/tool"); // matches package-name input
  expect(main.version).toBe("1.2.3");
  expect(main.bin).toEqual({ tool: "./launcher.cjs" });
  expect(main.optionalDependencies["@jamestelfer/tool-windows-x64"]).toBe("1.2.3");
  expect(main.chinmina.platforms["win32-x64"]).toBeDefined();
});

test("divergent consumer name is overridden to the package-name input", () => {
  const env = setup("artifacts-no-windows.json", {
    name: "@jamestelfer/stale-old-name",
    description: "tool",
    license: "MIT",
  });
  expect(runPublish(env).status).toBe(0);
  // Main package published under the base name, matching its platform family.
  expect(publishes(env)).toContain("@jamestelfer/tool");
  expect(publishes(env)).not.toContain("@jamestelfer/stale-old-name");
  expect(captured(env, "@jamestelfer/tool").name).toBe("@jamestelfer/tool");
});

test("prerelease version publishes everything (tag next path exercised)", () => {
  const env = setup("artifacts-no-windows.json", minimalConsumer);
  const res = runPublish(env, "1.2.3-rc.1");
  expect(res.status).toBe(0);
  expect(publishes(env)).toHaveLength(5);
  expect(captured(env, "@jamestelfer/tool").version).toBe("1.2.3-rc.1");
});

test("bad consumer input fails before any publish", () => {
  const env = setup("artifacts-windows.json", { description: "no name" });
  const res = runPublish(env);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/name/);
  expect(publishes(env)).toHaveLength(0);
});

test("empty archive set fails before any publish", () => {
  const env = setup("artifacts-windows.json", minimalConsumer);
  // Overwrite artifacts with a no-archive set after fixture build.
  writeFileSync(env.artifactsPath, JSON.stringify([{ type: "Checksum", path: "x" }]));
  const res = runPublish(env);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/no qualifying/);
  expect(publishes(env)).toHaveLength(0);
});
