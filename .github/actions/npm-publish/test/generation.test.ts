import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  discoverArchives,
  mainPackage,
  nodeOs,
  npmCpu,
  platformPackage,
  platformPackageName,
  platformsMap,
  validateArchives,
  validateConsumer,
  validateMappings,
  type DiscoveredArchive,
} from "../src/npm-publish.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const REPO = "https://github.com/jamestelfer/tool";
const BASE = "@jamestelfer/tool";

async function loadArtifacts(name: string): Promise<DiscoveredArchive[]> {
  return discoverArchives(await Bun.file(join(FIXTURES, name)).json());
}

const windows = () => loadArtifacts("artifacts-windows.json");
const noWindows = () => loadArtifacts("artifacts-no-windows.json");

const consumerMinimal = {
  name: BASE,
  description: "A helpful tool",
  homepage: "https://example.com/tool",
  license: "MIT",
  keywords: ["cli", "tool"],
};

// --- Phase 1: naming & field split -----------------------------------------

describe("mapping", () => {
  test("windows goos maps to win32 os field", () => {
    expect(nodeOs("windows")).toBe("win32");
    expect(nodeOs("linux")).toBe("linux");
    expect(nodeOs("darwin")).toBe("darwin");
  });

  test("goarch maps to npm cpu token", () => {
    expect(npmCpu("amd64")).toBe("x64");
    expect(npmCpu("arm64")).toBe("arm64");
    expect(npmCpu("386")).toBe("ia32");
    expect(npmCpu("arm")).toBe("arm");
  });

  test("unknown goos/goarch throws", () => {
    expect(() => nodeOs("plan9")).toThrow(/unknown goos/);
    expect(() => npmCpu("riscv64")).toThrow(/unknown goarch/);
  });
});

test("platform package name keeps raw windows goos token", () => {
  expect(platformPackageName(BASE, "windows", "amd64")).toBe(
    "@jamestelfer/tool-windows-x64",
  );
  expect(platformPackageName(BASE, "linux", "arm64")).toBe(
    "@jamestelfer/tool-linux-arm64",
  );
});

test("windows platform package: name uses windows, os field uses win32", async () => {
  const entries = await windows();
  const win = entries.find((e) => e.goos === "windows" && e.goarch === "amd64")!;
  const pkg = platformPackage(win, { base: BASE, version: "1.2.3", repoUrl: REPO });
  expect(pkg.name).toBe("@jamestelfer/tool-windows-x64");
  expect(pkg.os).toEqual(["win32"]);
  expect(pkg.cpu).toEqual(["x64"]);
  expect(pkg.files).toEqual(["tool.exe"]);
  expect(pkg.repository).toEqual({ type: "git", url: REPO });
});

test("discovery excludes source/checksum and no-binary entries", async () => {
  const entries = await windows();
  expect(entries).toHaveLength(4);
  expect(entries.every((e) => e.binary)).toBe(true);
});

test("no-windows fixture yields linux/darwin packages equivalent to prior", async () => {
  const entries = await noWindows();
  const names = entries
    .map((e) => platformPackageName(BASE, e.goos, e.goarch))
    .sort();
  expect(names).toEqual([
    "@jamestelfer/tool-darwin-arm64",
    "@jamestelfer/tool-darwin-x64",
    "@jamestelfer/tool-linux-arm64",
    "@jamestelfer/tool-linux-x64",
  ]);
  for (const e of entries) {
    const pkg = platformPackage(e, { base: BASE, version: "1.0.0", repoUrl: REPO });
    expect(pkg.os[0]).toBe(e.goos); // goos == node os for non-windows
  }
});

// --- Phase 2: chinmina.platforms map ----------------------------------------

test("platforms map keys win32-* to windows-named package", async () => {
  const map = platformsMap(await windows(), BASE);
  expect(map["win32-x64"]).toEqual({
    package: "@jamestelfer/tool-windows-x64",
    bin: "tool.exe",
  });
  expect(map["win32-arm64"]).toEqual({
    package: "@jamestelfer/tool-windows-arm64",
    bin: "tool.exe",
  });
  expect(map["linux-x64"]).toEqual({
    package: "@jamestelfer/tool-linux-x64",
    bin: "tool",
  });
  expect(Object.keys(map)).toHaveLength(4);
});

// --- Phase 3: main package.json derivation ----------------------------------

test("main package: full overrides ignore junk input values", async () => {
  const consumer = {
    name: BASE,
    version: "0.0.0-dev",
    engines: { node: ">=20" },
    files: ["extra.txt", "README.md"],
    optionalDependencies: { "@jamestelfer/tool-win32-x64": "0.0.0-dev", junk: "1.2.3" },
    repository: { type: "git", url: "https://example.com/old" },
  };
  const derived = mainPackage(consumer, {
    entries: await noWindows(),
    version: "2.0.0",
    repoUrl: REPO,
    base: BASE,
    launcher: "launcher.cjs",
  });
  expect(derived.version).toBe("2.0.0");
  expect(derived.repository).toEqual({ type: "git", url: REPO });
  expect(derived.optionalDependencies).toEqual({
    "@jamestelfer/tool-linux-x64": "2.0.0",
    "@jamestelfer/tool-linux-arm64": "2.0.0",
    "@jamestelfer/tool-darwin-x64": "2.0.0",
    "@jamestelfer/tool-darwin-arm64": "2.0.0",
  });
  // engines preserved when present; files unioned without loss/dupes.
  expect(derived.engines).toEqual({ node: ">=20" });
  expect(derived.files).toEqual(["launcher.cjs", "README.md", "extra.txt"]);
});

test("main package: bin defaults to unscoped name; engines set when absent", async () => {
  const derived = mainPackage(consumerMinimal, {
    entries: await noWindows(),
    version: "1.0.0",
    repoUrl: REPO,
    base: BASE,
    launcher: "launcher.cjs",
  });
  expect(derived.bin).toEqual({ tool: "./launcher.cjs" });
  expect(derived.engines).toEqual({ node: ">=18" });
});

test("main package: command-name override changes bin key", async () => {
  const derived = mainPackage(
    { name: BASE, chinmina: { command: "mytool" } },
    { entries: await noWindows(), version: "1.0.0", repoUrl: REPO, base: BASE, launcher: "launcher.cjs" },
  );
  expect(derived.bin).toEqual({ mytool: "./launcher.cjs" });
});

test("main package: name derived from base, overriding a divergent consumer name", async () => {
  const derived = mainPackage(
    { name: "@jamestelfer/WRONG-name", description: "x", license: "MIT" },
    { entries: await noWindows(), version: "1.0.0", repoUrl: REPO, base: BASE, launcher: "launcher.cjs" },
  );
  // name must match the family its optionalDependencies/chinmina/bin reference.
  expect(derived.name).toBe(BASE);
  const depFamily = Object.keys(derived.optionalDependencies as object).every((k) =>
    k.startsWith(`${BASE}-`),
  );
  expect(depFamily).toBe(true);
});

test("main package: metadata untouched; chinmina overrides consumer block", async () => {
  const derived = mainPackage(
    { ...consumerMinimal, chinmina: { command: "x" } },
    { entries: await windows(), version: "1.0.0", repoUrl: REPO, base: BASE, launcher: "launcher.cjs" },
  );
  expect(derived.description).toBe(consumerMinimal.description);
  expect(derived.homepage).toBe(consumerMinimal.homepage);
  expect(derived.license).toBe(consumerMinimal.license);
  expect(derived.keywords).toEqual(consumerMinimal.keywords);
  expect((derived.chinmina as any).platforms["win32-x64"]).toBeDefined();
  expect((derived.chinmina as any).command).toBeUndefined();
});

// --- Phase 4: validation -----------------------------------------------------

test("validateConsumer rejects missing name", () => {
  expect(() => validateConsumer({ description: "no name" })).toThrow(/name/);
  expect(() => validateConsumer(null)).toThrow(/invalid/);
});

test("validateArchives rejects empty archive set", () => {
  expect(discoverArchives([{ type: "Checksum" }])).toHaveLength(0);
  expect(() => validateArchives([])).toThrow(/no qualifying/);
});

test("validateMappings rejects unknown goos before publish", () => {
  const entries = discoverArchives([
    {
      type: "Archive",
      path: "dist/x",
      goos: "plan9",
      goarch: "amd64",
      extra: { Format: "tar.gz", Binaries: ["tool"] },
    },
  ]);
  expect(() => validateMappings(entries)).toThrow(/unknown goos/);
});
