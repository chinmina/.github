import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  discoverArchives,
  parseConsumer,
  planRelease,
  type Archive,
  type Consumer,
  type PublishPlan,
} from "../src/npm-publish.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const REPO = "https://github.com/jamestelfer/tool";
const BASE = "@jamestelfer/tool";

async function loadArtifacts(name: string): Promise<Archive[]> {
  return discoverArchives(await Bun.file(join(FIXTURES, name)).json());
}
const windows = () => loadArtifacts("artifacts-windows.json");
const noWindows = () => loadArtifacts("artifacts-no-windows.json");

// planRelease's signature is (consumer, archives, opts); wrap it with the
// fixtures pre-loaded for terse tests.
async function planFor(
  fixture: string,
  consumer: Consumer,
  over: Partial<{ base: string; version: string; repoUrl: string; launcher: string }> = {},
): Promise<PublishPlan> {
  return planRelease(consumer, await loadArtifacts(fixture), {
    base: BASE,
    version: "1.0.0",
    repoUrl: REPO,
    launcher: "launcher.cjs",
    ...over,
  });
}

const consumerMinimal: Consumer = {
  name: BASE,
  description: "A helpful tool",
  homepage: "https://example.com/tool",
  license: "MIT",
  keywords: ["cli", "tool"],
} as Consumer;

const names = (p: PublishPlan) => p.platforms.map((x) => x.manifest.name).sort();
const chinmina = (p: PublishPlan) => (p.main.chinmina as { platforms: Record<string, unknown> }).platforms;

// --- Discovery: naming & field split, fail-fast -----------------------------

test("discovery normalizes goreleaser coordinates; skips non-archives", async () => {
  const entries = await windows();
  expect(entries).toHaveLength(4); // Source + Checksum excluded
  const win = entries.find((e) => e.platform.nameToken === "windows" && e.platform.cpu === "x64")!;
  // name token stays raw `windows`; os field is Node's `win32`.
  expect(win.platform).toEqual({ nameToken: "windows", os: "win32", cpu: "x64", key: "win32-x64" });
  expect(win.binary).toBe("tool.exe");
});

test("discovery rejects an Archive with an unknown goos/goarch (fail-fast)", () => {
  const entry = (over: object) => [
    { type: "Archive", path: "dist/x", goos: "linux", goarch: "amd64", extra: { Format: "tar.gz", Binaries: ["t"] }, ...over },
  ];
  expect(() => discoverArchives(entry({ goos: "plan9" }))).toThrow(/unsupported archive dist\/x/);
  expect(() => discoverArchives(entry({ goarch: "riscv64" }))).toThrow(/unsupported archive dist\/x/);
});

// --- Platform packages ------------------------------------------------------

test("windows platform package: name uses windows, os field uses win32", async () => {
  const p = await planFor("artifacts-windows.json", consumerMinimal, { version: "1.2.3" });
  const win = p.platforms.find((x) => x.manifest.name.endsWith("-windows-x64"))!.manifest;
  expect(win).toEqual({
    name: "@jamestelfer/tool-windows-x64",
    version: "1.2.3",
    os: ["win32"],
    cpu: ["x64"],
    files: ["tool.exe"],
    license: "MIT",
    repository: { type: "git", url: REPO },
  });
});

test("no-windows fixture yields the four linux/darwin packages", async () => {
  const p = await planFor("artifacts-no-windows.json", consumerMinimal);
  expect(names(p)).toEqual([
    "@jamestelfer/tool-darwin-arm64",
    "@jamestelfer/tool-darwin-x64",
    "@jamestelfer/tool-linux-arm64",
    "@jamestelfer/tool-linux-x64",
  ]);
  for (const { archive, manifest } of p.platforms) {
    expect(manifest.os[0]).toBe(archive.platform.os); // goos == node os for non-windows
  }
});

test("empty archive set fails before planning", () => {
  expect(() => planRelease(consumerMinimal, [], { base: BASE, version: "1.0.0", repoUrl: REPO, launcher: "l.cjs" })).toThrow(/no qualifying/);
});

// --- chinmina.platforms map -------------------------------------------------

test("chinmina map keys win32-* to windows-named package", async () => {
  const map = chinmina(await planFor("artifacts-windows.json", consumerMinimal));
  expect(map["win32-x64"]).toEqual({ package: "@jamestelfer/tool-windows-x64", bin: "tool.exe" });
  expect(map["win32-arm64"]).toEqual({ package: "@jamestelfer/tool-windows-arm64", bin: "tool.exe" });
  expect(map["linux-x64"]).toEqual({ package: "@jamestelfer/tool-linux-x64", bin: "tool" });
  expect(Object.keys(map)).toHaveLength(4);
});

// --- Main package.json derivation -------------------------------------------

test("main package: full overrides ignore junk input; files unioned; engines kept", async () => {
  const consumer = {
    name: BASE,
    version: "0.0.0-dev",
    engines: { node: ">=20" },
    files: ["extra.txt", "README.md"],
    optionalDependencies: { junk: "1.2.3" },
    repository: { type: "git", url: "https://example.com/old" },
  } as Consumer;
  const { main } = await planFor("artifacts-no-windows.json", consumer, { version: "2.0.0" });
  expect(main.version).toBe("2.0.0");
  expect(main.repository).toEqual({ type: "git", url: REPO });
  expect(main.optionalDependencies).toEqual({
    "@jamestelfer/tool-linux-x64": "2.0.0",
    "@jamestelfer/tool-linux-arm64": "2.0.0",
    "@jamestelfer/tool-darwin-x64": "2.0.0",
    "@jamestelfer/tool-darwin-arm64": "2.0.0",
  });
  expect(main.engines).toEqual({ node: ">=20" }); // preserved when present
  expect(main.files).toEqual(["launcher.cjs", "README.md", "extra.txt"]); // union, deduped
});

test("main package: bin defaults to unscoped name; engines set when absent", async () => {
  const { main } = await planFor("artifacts-no-windows.json", consumerMinimal);
  expect(main.bin).toEqual({ tool: "./launcher.cjs" });
  expect(main.engines).toEqual({ node: ">=18" });
});

test("main package: command-name override changes bin key", async () => {
  const { main } = await planFor("artifacts-no-windows.json", { name: BASE, chinmina: { command: "mytool" } } as Consumer);
  expect(main.bin).toEqual({ mytool: "./launcher.cjs" });
});

test("main package: name derived from base, overriding a divergent consumer name", async () => {
  const { main } = await planFor("artifacts-no-windows.json", { name: "@jamestelfer/WRONG", license: "MIT" } as Consumer);
  expect(main.name).toBe(BASE);
  expect(Object.keys(main.optionalDependencies as object).every((k) => k.startsWith(`${BASE}-`))).toBe(true);
});

test("main package: metadata untouched; chinmina overrides consumer block", async () => {
  const { main } = await planFor("artifacts-windows.json", { ...consumerMinimal, chinmina: { command: "x" } } as Consumer);
  expect(main.description).toBe(consumerMinimal.description);
  expect(main.homepage).toBe(consumerMinimal.homepage);
  expect(main.license).toBe(consumerMinimal.license);
  expect(main.keywords).toEqual(consumerMinimal.keywords);
  expect((main.chinmina as { platforms: Record<string, unknown> }).platforms["win32-x64"]).toBeDefined();
  expect((main.chinmina as { command?: unknown }).command).toBeUndefined();
});

// --- Consumer parsing -------------------------------------------------------

test("parseConsumer rejects missing name; preserves unknown metadata", () => {
  expect(() => parseConsumer({ description: "no name" })).toThrow(/name/);
  expect(() => parseConsumer(null)).toThrow(/invalid/);
  const parsed = parseConsumer({ name: BASE, homepage: "https://x", extra: 1 }) as Record<string, unknown>;
  expect(parsed.homepage).toBe("https://x");
  expect(parsed.extra).toBe(1);
});
