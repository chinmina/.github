// Pure, typed generation logic for the npm-publish action.
//
// Naming vs field split (see PRD): the platform package *name* uses
// goreleaser's raw `goos` token (linux/darwin/windows) so it matches the
// package names already registered for OIDC trusted publishing. The npm `os`
// *field* uses Node's value (win32), which npm uses for optional-dependency
// install gating. Only Windows diverges between the two.

import { z } from "zod";

// goreleaser goos -> Node process.platform value (used for the `os` field and
// the runtime platform-map key).
const NODE_OS: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
  windows: "win32",
};

// goreleaser goarch -> npm arch token (used for both the name arch token and
// the `cpu` field; they legitimately coincide).
const NPM_CPU: Record<string, string> = {
  amd64: "x64",
  arm64: "arm64",
  "386": "ia32",
  arm: "arm",
};

const DEFAULT_ENGINES = { node: ">=18" } as const;

export function nodeOs(goos: string): string {
  const os = NODE_OS[goos];
  if (!os) throw new Error(`unknown goos '${goos}'`);
  return os;
}

export function npmCpu(goarch: string): string {
  const cpu = NPM_CPU[goarch];
  if (!cpu) throw new Error(`unknown goarch '${goarch}'`);
  return cpu;
}

// Strip an npm scope (`@scope/name` -> `name`).
export function unscopedName(name: string): string {
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

// --- Schemas ----------------------------------------------------------------

// A goreleaser Archive entry carrying at least one binary. Any entry that does
// not match (Source archives, checksums, ...) is skipped during discovery.
const ArchiveEntrySchema = z.object({
  type: z.literal("Archive"),
  path: z.string(),
  goos: z.string(),
  goarch: z.string(),
  extra: z.object({
    Format: z.string(),
    Binaries: z.array(z.string()).min(1),
  }),
});

// Consumer main package.json. A non-empty `name` is required so the file is a
// valid manifest, but its value is IGNORED: the main package name is derived
// from the action's package-name input (see mainPackage). Everything else is
// optional and preserved untouched. Validation only — the raw object is spread
// into the derived package so unknown metadata (description/homepage/...) is
// kept regardless of what the schema lists.
export const ConsumerSchema = z.object({
  name: z.string().min(1, 'must declare a non-empty "name"'),
  files: z.array(z.string()).optional(),
  engines: z.record(z.string(), z.string()).optional(),
  chinmina: z.object({ command: z.string().optional() }).optional(),
});

export interface DiscoveredArchive {
  path: string;
  format: string;
  goos: string;
  goarch: string;
  binary: string;
}

export interface PlatformPackage {
  name: string;
  version: string;
  os: [string];
  cpu: [string];
  files: [string];
  license: string;
  repository: { type: "git"; url: string };
}

export interface PlatformMapEntry {
  package: string;
  bin: string;
}

// --- Discovery --------------------------------------------------------------

// Discover the platform archives to publish: Archive entries with at least one
// binary. Non-matching artifact types are silently skipped.
export function discoverArchives(artifacts: unknown): DiscoveredArchive[] {
  const list = z.array(z.unknown()).parse(artifacts);
  const out: DiscoveredArchive[] = [];
  for (const raw of list) {
    const parsed = ArchiveEntrySchema.safeParse(raw);
    if (!parsed.success) continue;
    const a = parsed.data;
    out.push({
      path: a.path,
      format: a.extra.Format,
      goos: a.goos,
      goarch: a.goarch,
      binary: a.extra.Binaries[0]!,
    });
  }
  return out;
}

// --- Generation -------------------------------------------------------------

// Platform package name: `<base>-<goos>-<npm-cpu>` (goos token stays raw).
export function platformPackageName(
  base: string,
  goos: string,
  goarch: string,
): string {
  return `${base}-${goos}-${npmCpu(goarch)}`;
}

// Node platform-map key: `<node-os>-<npm-cpu>` (e.g. `win32-x64`).
export function platformKey(goos: string, goarch: string): string {
  return `${nodeOs(goos)}-${npmCpu(goarch)}`;
}

export function platformPackage(
  entry: DiscoveredArchive,
  opts: { base: string; version: string; repoUrl: string },
): PlatformPackage {
  return {
    name: platformPackageName(opts.base, entry.goos, entry.goarch),
    version: opts.version,
    os: [nodeOs(entry.goos)],
    cpu: [npmCpu(entry.goarch)],
    files: [entry.binary],
    license: "MIT",
    repository: { type: "git", url: opts.repoUrl },
  };
}

// Build the chinmina.platforms map: Node platform-arch key -> {package, bin}.
// `package` is the windows-named platform package; `bin` is the exact binary
// filename from goreleaser (so `.exe` is data, not launcher code).
export function platformsMap(
  entries: DiscoveredArchive[],
  base: string,
): Record<string, PlatformMapEntry> {
  const platforms: Record<string, PlatformMapEntry> = {};
  for (const entry of entries) {
    platforms[platformKey(entry.goos, entry.goarch)] = {
      package: platformPackageName(base, entry.goos, entry.goarch),
      bin: entry.binary,
    };
  }
  return platforms;
}

// Union two file lists preserving order and removing duplicates.
export function unionFiles(
  defaults: string[],
  supplied: unknown,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const extra = Array.isArray(supplied) ? (supplied as string[]) : [];
  for (const f of [...defaults, ...extra]) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
}

// Derive the complete main package.json from the consumer's raw input object.
// The raw object is spread first so consumer-owned metadata is preserved; the
// action then overrides the derived fields.
export function mainPackage(
  consumer: Record<string, unknown>,
  opts: {
    entries: DiscoveredArchive[];
    version: string;
    repoUrl: string;
    base: string;
    launcher: string;
  },
): Record<string, unknown> {
  const chinmina = consumer.chinmina as { command?: string } | undefined;
  const commandName = chinmina?.command ?? unscopedName(opts.base);

  const optionalDependencies: Record<string, string> = {};
  for (const entry of opts.entries) {
    optionalDependencies[
      platformPackageName(opts.base, entry.goos, entry.goarch)
    ] = opts.version;
  }

  const result: Record<string, unknown> = { ...consumer };
  // Full overrides.
  // `name` is derived from the action's package-name input (opts.base), NOT the
  // consumer package.json: base is the single source of truth for the whole
  // package family, so the main package's name must match the family its
  // optionalDependencies/chinmina map/bin reference.
  result.name = opts.base;
  result.version = opts.version;
  result.repository = { type: "git", url: opts.repoUrl };
  result.bin = { [commandName]: `./${opts.launcher}` };
  result.optionalDependencies = optionalDependencies;
  // Union.
  result.files = unionFiles([opts.launcher, "README.md"], consumer.files);
  // Set-if-absent.
  if (!result.engines) result.engines = { ...DEFAULT_ENGINES };
  // Data-driven launcher map (replaces any consumer-supplied chinmina block).
  result.chinmina = { platforms: platformsMap(opts.entries, opts.base) };
  return result;
}

// --- Validation -------------------------------------------------------------

// Validate the consumer main package.json shape (fail-fast). Throws a readable
// error naming the offending field.
export function validateConsumer(raw: unknown): void {
  const parsed = ConsumerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `main package.json is invalid:\n${z.prettifyError(parsed.error)}`,
    );
  }
}

// Validate that there is something to publish (fail-fast).
export function validateArchives(entries: DiscoveredArchive[]): void {
  if (entries.length === 0) {
    throw new Error(
      "no qualifying Archive entries found in artifacts.json " +
        "(need type==Archive with at least one binary)",
    );
  }
}

// Validate every discovered platform maps to a known Node os/cpu (fail-fast,
// rather than mid-publish). Throws naming the offending archive.
export function validateMappings(entries: DiscoveredArchive[]): void {
  for (const entry of entries) {
    try {
      nodeOs(entry.goos);
      npmCpu(entry.goarch);
    } catch (err) {
      throw new Error(`${(err as Error).message} (archive ${entry.path})`);
    }
  }
}
